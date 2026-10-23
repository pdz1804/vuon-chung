// The homestead scene: draws the map, moves the farmer, shows the partner, and
// turns the "use" input into farm actions applied through the WorldStore.
import Phaser from 'phaser';
import { now, vnHour } from '../clock';
import { t } from '../i18n';
import type { Pose, Presence } from '../net/presence';
import type { Look, WorldStore } from '../net/world-store';
import {
  buySeeds,
  cropStage,
  cropWilted,
  payout,
  plotState,
  ship,
  useTile,
  vnDay,
  type ActionResult,
} from '../sim/farm';
import { addMemory, partnerTendedToday, readLetters, sendLetter, treeStage, unreadFor } from '../sim/couple';
import { animalPosition, buyAnimal, fedToday, fillFeeder, useAnimal } from '../sim/animals';
import { cook } from '../sim/kitchen';
import { deliverDuo, fulfill } from '../sim/orders';
import { ROLE_IDS, chooseRole, rankFor } from '../sim/roles';
import { UNLOCKS, isUnlocked, levelFor } from '../sim/progression';
import { rainingAt } from '../sim/weather';
import { SPECIES_IDS, type SpeciesId } from '../sim/species';
import { Hud, drawIcon, setIconSource } from '../ui/hud';
import { Panels } from '../ui/panels';
import { TILE, buildTextures } from './textures';
import { BLOCKING, MAP_H, MAP_W, PEN, PROPS, SPAWN, buildGround, isFieldTile, propAt } from './world-map';

const SPEED = 70; // px per second in world units
/** Walking side by side with your partner is a little faster. */
const TOGETHER_BOOST = 1.25;
/** The only emotes the game sends or shows. */
export const EMOTES = ['❤️', '👋', '🌱', '😂'];
const CHICK_NAMES = ['Bông', 'Mít', 'Xôi', 'Na', 'Mochi', 'Bắp', 'Sữa', 'Kem'];
type Facing = 'down' | 'up' | 'left' | 'right';
const DIRS: Record<Facing, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
const SHORT: Record<Facing, Pose['f']> = { down: 'd', up: 'u', left: 'l', right: 'r' };
const LONG: Record<Pose['f'], Facing> = { d: 'down', u: 'up', l: 'left', r: 'right' };

export interface SceneBoot {
  store: WorldStore;
  isNew: boolean;
  /** Starts live avatar sync once the scene can draw partners. */
  connectPresence?: (onPartner: (uid: string, pose: Pose | null) => void) => Presence;
  hud: Hud;
}

interface Partner {
  sprite: Phaser.GameObjects.Sprite;
  tag: Phaser.GameObjects.Text;
  target: Pose;
}

function avatarTexture(look: Look, facing: Facing) {
  return facing === 'left' || facing === 'right' ? `${look}_side` : `${look}_${facing}`;
}

export class FarmScene extends Phaser.Scene {
  private store!: WorldStore;
  private hud!: Hud;
  private player!: Phaser.Physics.Arcade.Sprite;
  private look: Look = 'phu';
  private facing: Facing = 'down';
  private selected: SpeciesId = 'rau_muong';
  private soil = new Map<string, Phaser.GameObjects.Image>();
  private crops = new Map<string, Phaser.GameObjects.Image>();
  private partners = new Map<string, Partner>();
  private cursor!: Phaser.GameObjects.Rectangle;
  private night!: Phaser.GameObjects.Rectangle;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private lastClock = '';
  private lastPayoutTry = 0;
  private level = 0;
  private rain?: Phaser.GameObjects.Particles.ParticleEmitter;
  private wasRaining = false;
  private panels!: Panels;
  private tree!: Phaser.GameObjects.Image;
  private mailHeart!: Phaser.GameObjects.Image;
  private sparkles = new Map<string, Phaser.GameObjects.Image>();
  private unread = 0;
  private feederImg!: Phaser.GameObjects.Image;
  private animalSprites = new Map<string, Phaser.GameObjects.Image>();
  private seenEmote = new Map<string, number>();
  private together = false;
  private togetherToastAt = -Infinity;
  private ranks = new Map<string, number>();
  private busy = false;
  private presence?: Presence;

  constructor(private boot: SceneBoot) {
    super('farm');
  }

  create() {
    this.store = this.boot.store;
    this.hud = this.boot.hud;
    const me = this.store.uid ? this.store.profiles[this.store.uid] : undefined;
    this.look = me?.look ?? 'phu';
    buildTextures(this);
    setIconSource((id) => {
      const key = this.textures.exists(`${id}_4`) ? `${id}_4` : id;
      return this.textures.get(key).getSourceImage() as HTMLCanvasElement;
    });
    this.buildWorld();
    this.presence = this.boot.connectPresence?.((uid, p) => this.onPartner(uid, p));

    const cam = this.cameras.main;
    cam.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    cam.startFollow(this.player, true, 0.15, 0.15);
    cam.setRoundPixels(true);
    this.scale.on('resize', () => this.fitZoom());
    this.fitZoom();

    const kb = this.input.keyboard!;
    // enableCapture=false: keys must still reach the letter and memory text boxes.
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,E,ONE,TWO,THREE,FOUR,FIVE,SIX', false) as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    kb.on('keydown-SPACE', (e: KeyboardEvent) => {
      if (this.typing()) return;
      e.preventDefault(); // no page scroll
      void this.act();
    });
    kb.on('keydown-E', () => !this.typing() && void this.act());
    kb.on('keydown-ESC', () => {
      this.hud.closeModals();
      this.panels.close();
    });
    (['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'] as const).forEach((k, i) =>
      kb.on(`keydown-${k}`, () => !this.typing() && !this.hud.modalOpen && this.selectSeed(SPECIES_IDS[i])),
    );

    this.panels = new Panels({
      sendLetter: async (text) => (await this.run((s, ts, uid) => sendLetter(s, uid, text, ts)))?.ok ?? false,
      readLetters: () => void this.store.apply((s, _, uid) => readLetters(s, uid)).catch(console.error),
      chooseRole: (role) => void this.run((s, ts, uid) => chooseRole(s, uid, role, ts)),
      cook: (id) => void this.run((s) => cook(s, id)),
      addMemory: async (date, title) =>
        (await this.run((s, ts, uid) => addMemory(s, uid, date, title, ts)))?.ok ?? false,
    });
    this.hud.bind({
      onSelectSeed: (id) => this.selectSeed(id),
      onAction: () => void this.act(),
      onBuy: (id, n) => void this.run((s, _, uid) => buySeeds(s, id, n, uid)),
      onDeliver: (i) => void this.run((s, ts) => fulfill(s, i, ts)),
      onDeliverDuo: () => void this.run((s, ts, uid) => deliverDuo(s, uid, ts)),
      onBuyAnimal: (species) =>
        void this.run((s, ts) => buyAnimal(s, species, CHICK_NAMES[s.animals.length % CHICK_NAMES.length], ts)),
      onEmote: (e) => this.emote(e),
      onLangChange: () => this.refresh(),
    });

    // Partner edits arrive as snapshots: redraw everything that depends on state.
    this.store.onChange(() => this.refresh());

    this.refresh();
    if (this.boot.isNew) this.hud.toast(t('welcome'));
    this.showAwaySummary();

    // Growth is derived from time, so the field just redraws periodically.
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tick() });
    this.time.addEvent({ delay: 15000, loop: true, callback: () => this.store.flush() });
    window.addEventListener('beforeunload', () => {
      this.store.flush();
      this.presence?.leave();
    });
    if (location.hash === '#qa') {
      Object.assign(window, { __qa: { scene: this, farm: () => this.store.farm, partners: this.partners } });
    }
  }

  private buildWorld() {
    const ground = buildGround();
    const walls = this.physics.add.staticGroup();
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const g = ground[y][x];
        const px = x * TILE + TILE / 2;
        const py = y * TILE + TILE / 2;
        const base = g === 'path' || g === 'water' ? g : (x * 7 + y * 13) % 11 === 0 ? 'grass2' : 'grass';
        this.add.image(px, py, base);
        if (g === 'field') this.add.image(px, py, 'grass');
        if (g === 'fence' || g === 'tree') this.add.image(px, py, g).setDepth(py);
        if (BLOCKING.includes(g)) walls.add(this.add.zone(px, py, TILE, TILE));
      }
    }
    for (const p of PROPS) {
      const img = this.add.image(p.x * TILE, (p.y + p.h) * TILE, p.id).setOrigin(0, 1);
      img.setDepth((p.y + p.h) * TILE);
      // The Memory Tree grows past its tile, so anchor it bottom-centre.
      if (p.id === 'sapling') this.tree = img.setOrigin(0.5, 1).setX(p.x * TILE + 8);
      if (p.id === 'feeder') this.feederImg = img;
      if (p.id === 'mailbox') {
        this.mailHeart = this.add
          .image(p.x * TILE + 8, p.y * TILE - 4, 'heart')
          .setDepth(9050)
          .setVisible(false);
        this.tweens.add({ targets: this.mailHeart, y: '-=3', yoyo: true, repeat: -1, duration: 600 });
      }
      walls.add(this.add.zone(p.x * TILE + (p.w * TILE) / 2, p.y * TILE + (p.h * TILE) / 2, p.w * TILE, p.h * TILE));
    }

    // Partners spawn side by side at the gate.
    const offset = this.look === 'su' ? 1 : 0;
    this.player = this.physics.add.sprite((SPAWN.x + offset) * TILE + 8, SPAWN.y * TILE + 8, `${this.look}_down`);
    this.player.body!.setSize(10, 6).setOffset(3, 10);
    this.player.setCollideWorldBounds(true);
    this.physics.world.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    this.physics.add.collider(this.player, walls);

    // Rain falls across the camera view, not the whole map.
    this.rain = this.add
      .particles(0, 0, 'raindrop', {
        x: { min: 0, max: 1 }, // widened to the view in fitZoom()
        y: -8,
        speedY: { min: 160, max: 220 },
        speedX: -20,
        lifespan: 2200,
        quantity: 4,
        frequency: 30,
        alpha: { start: 0.8, end: 0.3 },
        emitting: false,
      })
      .setDepth(9600)
      .setScrollFactor(0);
    this.cursor = this.add.rectangle(0, 0, TILE, TILE).setStrokeStyle(1, 0xffffff, 0.9).setDepth(9000);
    this.night = this.add
      .rectangle(0, 0, MAP_W * TILE, MAP_H * TILE, 0x1a2350, 0)
      .setOrigin(0)
      .setDepth(9500);
  }

  private fitZoom() {
    const { width, height } = this.scale.gameSize;
    // Integer zoom keeps pixels crisp; aim for ~14 tiles across on phones.
    const zoom = Math.max(2, Math.floor(Math.min(width / (14 * TILE), height / (10 * TILE))));
    this.cameras.main.setZoom(zoom);
    // Rain is pinned to the screen; cover exactly the visible width.
    this.rain?.updateConfig({ x: { min: -20, max: width / zoom + 20 } });
  }

  update(_: number, dtMs: number) {
    const k = this.keys;
    let vx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    let vy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    if (!vx && !vy) ({ x: vx, y: vy } = this.hud.stick);
    if (this.hud.modalOpen || this.typing()) vx = vy = 0;
    const len = Math.hypot(vx, vy) || 1;
    const speed = SPEED * (this.walkingTogether(vx || vy ? 1 : 0) ? TOGETHER_BOOST : 1);
    this.player.setVelocity((vx / len) * speed, (vy / len) * speed);

    const moving = Math.abs(vx) > 0.3 || Math.abs(vy) > 0.3;
    if (moving) this.facing = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
    this.pose(this.player, this.look, this.facing, moving);

    const [tx, ty] = this.target();
    this.cursor.setPosition(tx * TILE + 8, ty * TILE + 8);
    this.presence?.publish({ x: this.player.x, y: this.player.y, f: SHORT[this.facing], m: moving });
    this.updatePartners(dtMs);
    this.updateAnimals();
  }

  /** True while you and your partner walk side by side (shows a toast once per stroll). */
  private walkingTogether(moving: number): boolean {
    const p = [...this.partners.values()][0];
    const dist = p ? Math.hypot(p.sprite.x - this.player.x, p.sprite.y - this.player.y) : Infinity;
    // Enter at 24px, leave at 36px, so network jitter doesn't flicker the state.
    const near = !!p && moving > 0 && p.target.m && dist < (this.together ? 36 : 24);
    if (near && !this.together && this.time.now - this.togetherToastAt > 15_000) {
      this.togetherToastAt = this.time.now;
      this.hud.toast(t('walk_together'));
    }
    this.together = near;
    return near;
  }

  /** Chickens wander on a clock-derived path, identical on both phones. */
  private updateAnimals() {
    // Real time, not the game clock: wandering is cosmetic and must stay calm
    // even when the dev clock runs fast.
    const ts = Date.now();
    const animals = this.store.farm.animals;
    const alive = new Set(animals.map((a) => a.id));
    for (const [id, s] of this.animalSprites) {
      if (!alive.has(id)) {
        s.destroy();
        this.animalSprites.delete(id);
      }
    }
    animals.forEach((a, i) => {
      const pos = animalPosition(a.id, i, ts, PEN);
      const s =
        this.animalSprites.get(a.id) ?? this.animalSprites.set(a.id, this.add.image(0, 0, 'chicken_0')).get(a.id)!;
      s.setPosition(pos.x, pos.y)
        .setFlipX(pos.left)
        .setTexture(`${a.species}_${pos.moving ? Math.floor(this.time.now / 180) % 2 : 0}`)
        .setDepth(pos.y + 4);
    });
  }

  /** Shows an emote bubble over a sprite for a few seconds. */
  private bubble(over: Phaser.GameObjects.Sprite, e: string) {
    const b = this.add
      .text(over.x, over.y - 18, e, { fontSize: '24px' })
      .setOrigin(0.5, 1)
      .setScale(0.5)
      .setDepth(9200);
    const lift = { dy: 0 };
    // Follow the avatar while it walks, then drift up and fade.
    const follow = () => b.setPosition(over.x, over.y - 18 - lift.dy);
    this.events.on('update', follow);
    this.tweens.add({
      targets: lift,
      dy: 8,
      delay: 1800,
      duration: 700,
      onUpdate: () => b.setAlpha(1 - lift.dy / 8),
      onComplete: () => {
        this.events.off('update', follow);
        b.destroy();
      },
    });
  }

  private emote(e: string) {
    this.bubble(this.player, e);
    this.presence?.sendEmote(e);
  }

  /** Applies texture, flip, walk bob and depth for any avatar. */
  private pose(s: Phaser.GameObjects.Sprite, look: Look, facing: Facing, moving: boolean) {
    s.setTexture(avatarTexture(look, facing)).setFlipX(facing === 'left');
    s.setDisplayOrigin(8, 8 + (moving ? Math.floor(this.time.now / 150) % 2 : 0));
    s.setDepth(s.y + 4);
  }

  /** Called by Presence when the partner moves, appears or leaves. */
  onPartner(uid: string, p: Pose | null) {
    const existing = this.partners.get(uid);
    if (!p) {
      existing?.sprite.destroy();
      existing?.tag.destroy();
      this.partners.delete(uid);
      return;
    }
    if (existing) {
      existing.target = p;
      // A newer emote from the partner: show it once.
      if (p.e && EMOTES.includes(p.e) && p.et && p.et > (this.seenEmote.get(uid) ?? 0)) {
        if (this.seenEmote.has(uid)) this.bubble(existing.sprite, p.e);
        this.seenEmote.set(uid, p.et);
      }
      return;
    }
    this.seenEmote.set(uid, p.et ?? 0);
    const profile = this.store.profiles[uid];
    const sprite = this.add.sprite(p.x, p.y, avatarTexture(profile?.look ?? 'su', LONG[p.f]));
    const tag = this.add
      .text(p.x, p.y - 14, profile?.name ?? '', {
        fontFamily: 'Nunito, sans-serif',
        fontSize: '16px',
        color: '#ffffff',
        stroke: '#2b2a24',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setScale(0.5)
      .setDepth(9100);
    this.partners.set(uid, { sprite, tag, target: p });
  }

  /** Eases each partner toward their last reported position. */
  private updatePartners(dtMs: number) {
    const a = Math.min(1, dtMs / 90);
    for (const [uid, pt] of this.partners) {
      const s = pt.sprite;
      const far = Math.hypot(pt.target.x - s.x, pt.target.y - s.y) > 48;
      s.setPosition(
        far ? pt.target.x : s.x + (pt.target.x - s.x) * a,
        far ? pt.target.y : s.y + (pt.target.y - s.y) * a,
      );
      this.pose(s, this.store.profiles[uid]?.look ?? 'su', LONG[pt.target.f], pt.target.m);
      pt.tag.setPosition(s.x, s.y - 9);
      // The joiner's profile can arrive after their first position.
      const name = this.store.profiles[uid]?.name ?? '';
      if (pt.tag.text !== name) pt.tag.setText(name);
    }
  }

  /** Tile in front of the farmer. */
  private target(): [number, number] {
    const [dx, dy] = DIRS[this.facing];
    const cx = Math.floor(this.player.x / TILE);
    const cy = Math.floor((this.player.y + 4) / TILE);
    return [cx + dx, cy + dy];
  }

  private async act() {
    if (this.hud.modalOpen) return;
    const [x, y] = this.target();
    // Animals first: they stand on tiles that are otherwise free.
    const cx = x * TILE + 8;
    const cy = y * TILE + 8;
    // The nearest animal to the targeted tile, if any is close enough.
    let best: { id: string; d: number } | null = null;
    for (const a of this.store.farm.animals) {
      const s = this.animalSprites.get(a.id);
      const d = s ? Math.hypot(s.x - cx, s.y - cy) : Infinity;
      if (d < 14 && (!best || d < best.d)) best = { id: a.id, d };
    }
    if (best) {
      const id = best.id;
      return this.run((st, ts, uid) => useAnimal(st, id, uid, ts));
    }
    const prop = propAt(x, y);
    if (prop?.id === 'house') {
      if (!isUnlocked('kitchen', this.store.farm.xp)) return this.hud.toast(t('locked_kitchen'));
      return this.panels.openKitchen(this.store.farm, drawIcon);
    }
    if (prop?.id === 'feeder') return this.run((s, ts, uid) => fillFeeder(s, ts, uid));
    if (prop?.id === 'coop') return this.hud.openShop(this.store.farm, this.store.uid);
    if (prop?.id === 'bin') return this.run((s, ts) => ship(s, ts));
    if (prop?.id === 'stall') return this.hud.openShop(this.store.farm, this.store.uid);
    if (prop?.id === 'sapling') return this.panels.openTree(this.store.farm, this.names());
    if (prop?.id === 'mailbox') return this.panels.openMail(this.store.farm, this.store.uid, this.names());
    if (prop?.id === 'board') {
      if (!isUnlocked('orders', this.store.farm.xp)) return this.hud.toast(t('locked_orders'));
      return this.hud.openOrders(this.store.farm, now(), this.duoContext());
    }
    if (!isFieldTile(x, y)) return this.hud.toast(t('cant_farm'));
    const selected = this.selected;
    return this.run((s, ts, uid) => useTile(s, x, y, selected, ts, uid));
  }

  /** Runs one action through the store and reports it. One at a time. */
  private async run(
    action: (s: typeof this.store.farm, ts: number, uid: string) => ActionResult,
  ): Promise<ActionResult | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const r = await this.store.apply(action);
      this.hud.toast(t(r.msg, r.vars));
      if (r.ok) this.refresh();
      return r;
    } catch (e) {
      console.error(e);
      this.hud.toast(t('sync_error'));
      return null;
    } finally {
      this.busy = false;
    }
  }

  private selectSeed(id: SpeciesId) {
    this.selected = id;
    this.hud.render(this.store.farm, this.selected);
  }

  private refresh() {
    // Level-ups can come from either partner, so detect them on every refresh.
    const lv = levelFor(this.store.farm.xp);
    if (this.level && lv > this.level) {
      // Name every unlock passed on the way (a delivery can jump several levels).
      const unlocks: string[] = [];
      for (let l = this.level + 1; l <= lv; l++) unlocks.push(...(UNLOCKS[l] ?? []).map((u) => t(`unlock.${u}`)));
      this.hud.toast(t('level_up', { n: lv }) + (unlocks.length ? ` · ${unlocks.join(' · ')}` : ''));
      this.cameras.main.flash(400, 255, 230, 160);
    }
    this.level = lv;
    this.drawField();
    this.hud.render(this.store.farm, this.selected);
    if (this.hud.shopOpen) this.hud.openShop(this.store.farm, this.store.uid);
    if (this.hud.ordersOpen) this.hud.openOrders(this.store.farm, now(), this.duoContext());
    if (this.panels.mailOpen) this.panels.openMail(this.store.farm, this.store.uid, this.names());
    if (this.panels.treeOpen) this.panels.openTree(this.store.farm, this.names());
    if (this.panels.kitchenOpen) this.panels.openKitchen(this.store.farm, drawIcon);
    this.syncRoles();
    this.feederImg.setTexture(fedToday(this.store.farm, now()) ? 'feeder_full' : 'feeder');
    this.hud.showEmotes(this.store.members.length >= 2);
    const stage = treeStage(this.store.farm);
    this.tree.setTexture(stage ? `memtree_${stage}` : 'sapling');
    const unread = unreadFor(this.store.farm, this.store.uid);
    this.mailHeart.setVisible(unread > 0);
    if (unread > this.unread) this.hud.toast(t('new_letter'));
    this.unread = unread;
    this.tick();
  }

  private tick() {
    const ts = now();
    const farm = this.store.farm;
    // Pay the bin once the Vietnam day changed; the transaction makes it pay once
    // even if both partners open the game at midnight.
    // At most one attempt a minute, so an offline phone doesn't spin.
    if (farm.binDay && farm.binDay !== vnDay(ts) && !this.busy && Date.now() - this.lastPayoutTry > 60_000) {
      this.lastPayoutTry = Date.now();
      this.busy = true;
      let paid = 0;
      void this.store
        .apply((s, n) => {
          paid = payout(s, n);
          return paid ? { ok: true, msg: 'payout' } : { ok: false, msg: 'payout' };
        })
        .then((r) => {
          if (r.ok) {
            this.hud.toast(t('payout', { value: paid }));
            this.refresh();
          }
        })
        .catch(console.error)
        .finally(() => (this.busy = false));
    }
    this.drawField();
    const h = vnHour(ts);
    // Darkness ramps 17–19h and 5–7h; fully dark overnight but never black.
    const dark = h >= 19 || h < 5 ? 1 : h >= 17 ? (h - 17) / 2 : h < 7 ? (7 - h) / 2 : 0;
    this.night.setAlpha(dark * 0.45);
    const clock = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    const raining = rainingAt(ts);
    if (clock !== this.lastClock || raining !== this.wasRaining) this.hud.setClock((this.lastClock = clock), raining);
    if (raining !== this.wasRaining) {
      this.wasRaining = raining;
      if (raining) this.hud.toast(t('raining'));
    }
    this.rain?.setVisible(raining);
    this.rain?.[raining ? 'start' : 'stop']();
  }

  /** True while a text field has focus: game hotkeys must not steal keystrokes. */
  private typing(): boolean {
    const el = document.activeElement;
    // A field inside a dialog closed with Esc keeps focus while hidden: ignore it.
    return (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.offsetParent !== null;
  }

  /** Roles button (from level 3), live dialog refresh, and a toast on rank-ups. */
  private syncRoles() {
    const farm = this.store.farm;
    const btn = document.querySelector<HTMLButtonElement>('#roles-btn')!;
    btn.hidden = !isUnlocked('roles', farm.xp);
    const me = farm.players[this.store.uid];
    // Compact on the bar (icon + rank) so the language toggle stays on screen on phones.
    const icon = { grower: '🌾', rancher: '🐔', florist: '🌸' } as const;
    btn.textContent = me?.role ? `${icon[me.role]} ${rankFor(me.roleXp[me.role] ?? 0)}★` : '🧑‍🌾';
    btn.title = me?.role ? t(`role.${me.role}`) : t('roles_btn');
    btn.setAttribute('aria-label', btn.title);
    btn.onclick = () => this.panels.openRoles(this.store.farm, this.store.uid, this.names());
    if (this.panels.rolesOpen) this.panels.openRoles(farm, this.store.uid, this.names());
    for (const role of ROLE_IDS) {
      const rank = rankFor(me?.roleXp[role] ?? 0);
      const before = this.ranks.get(role);
      if (before !== undefined && rank > before) {
        this.hud.toast(t('rank_up', { role: t(`role.${role}`), rank: t(`rank.${rank}`) }));
      }
      this.ranks.set(role, rank);
    }
  }

  /** The duo order only exists when both partners are in the garden. */
  private duoContext() {
    return this.store.members.length >= 2 ? { uid: this.store.uid, names: this.names() } : undefined;
  }

  /** uid → display name, for letters and memories. */
  private names(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [uid, p] of Object.entries(this.store.profiles)) out[uid] = p.name;
    return out;
  }

  /** On arrival, summarise what the partner did since this device last saw the farm. */
  private showAwaySummary() {
    if (this.store.members.length < 2) return;
    const key = `vuon-chung:seen:${this.store.worldId}:${this.store.uid}`;
    let since = 0;
    try {
      since = Number(localStorage.getItem(key)) || 0;
    } catch {
      /* storage blocked */
    }
    const partner = this.store.members.find((m) => m !== this.store.uid);
    if (since)
      this.panels.openAway(this.store.farm, this.store.uid, since, this.store.profiles[partner ?? '']?.name ?? '♥');
    const mark = () => {
      try {
        localStorage.setItem(key, String(now()));
      } catch {
        /* ignore */
      }
    };
    mark();
    this.time.addEvent({ delay: 30_000, loop: true, callback: mark });
    window.addEventListener('beforeunload', mark);
  }

  /** Syncs soil and crop images with the farm state. */
  private drawField() {
    const ts = now();
    for (const [k, plot] of Object.entries(this.store.farm.plots)) {
      const [x, y] = k.split(',').map(Number);
      const px = x * TILE + 8;
      const py = y * TILE + 8;
      const wet = plot.crop && plotState(plot, ts) !== 'needs_water';
      const soilTex = wet ? 'soil_wet' : 'soil';
      const soil = this.soil.get(k) ?? this.soil.set(k, this.add.image(px, py, soilTex).setDepth(1)).get(k)!;
      soil.setTexture(soilTex);

      // A sparkle marks plants your partner cared for today: tend them for ✋✋.
      const glow = !!plot.crop && partnerTendedToday(plot.crop, this.store.uid, ts);
      const sp = this.sparkles.get(k);
      if (glow && !sp) {
        const img = this.add.image(px + 4, py - 8, 'sparkle').setDepth(9020);
        this.tweens.add({ targets: img, alpha: 0.3, yoyo: true, repeat: -1, duration: 700 });
        this.sparkles.set(k, img);
      } else if (!glow && sp) {
        sp.destroy();
        this.sparkles.delete(k);
      }

      const existing = this.crops.get(k);
      if (!plot.crop) {
        existing?.destroy();
        this.crops.delete(k);
        continue;
      }
      const stage = cropStage(plot.crop, ts);
      const tex = `${plot.crop.species}_${stage}`;
      const img = existing ?? this.crops.set(k, this.add.image(px, py - 2, tex).setDepth(py)).get(k)!;
      img.setTexture(tex);
      if (cropWilted(plot.crop, ts)) img.setTint(0xc2a66a).setAngle(8);
      else img.clearTint().setAngle(0);
    }
  }
}

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
import { fulfill } from '../sim/orders';
import { UNLOCKS, isUnlocked, levelFor } from '../sim/progression';
import { rainingAt } from '../sim/weather';
import { SPECIES_IDS, type SpeciesId } from '../sim/species';
import { Hud, setIconSource } from '../ui/hud';
import { TILE, buildTextures } from './textures';
import { BLOCKING, MAP_H, MAP_W, PROPS, SPAWN, buildGround, isFieldTile, propAt } from './world-map';

const SPEED = 70; // px per second in world units
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
    setIconSource((id) => this.textures.get(`${id}_4`).getSourceImage() as HTMLCanvasElement);
    this.buildWorld();
    this.presence = this.boot.connectPresence?.((uid, p) => this.onPartner(uid, p));

    const cam = this.cameras.main;
    cam.setBounds(0, 0, MAP_W * TILE, MAP_H * TILE);
    cam.startFollow(this.player, true, 0.15, 0.15);
    cam.setRoundPixels(true);
    this.scale.on('resize', () => this.fitZoom());
    this.fitZoom();

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,E,ONE,TWO,THREE,FOUR') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    kb.on('keydown-SPACE', () => void this.act());
    kb.on('keydown-E', () => void this.act());
    kb.on('keydown-ESC', () => this.hud.closeModals());
    (['ONE', 'TWO', 'THREE', 'FOUR'] as const).forEach((k, i) =>
      kb.on(`keydown-${k}`, () => !this.hud.shopOpen && this.selectSeed(SPECIES_IDS[i])),
    );

    this.hud.bind({
      onSelectSeed: (id) => this.selectSeed(id),
      onAction: () => void this.act(),
      onBuy: (id, n) => void this.run((s) => buySeeds(s, id, n)),
      onDeliver: (i) => void this.run((s, ts) => fulfill(s, i, ts)),
      onLangChange: () => this.refresh(),
    });

    // Partner edits arrive as snapshots: redraw everything that depends on state.
    this.store.onChange(() => this.refresh());

    this.refresh();
    if (this.boot.isNew) this.hud.toast(t('welcome'));

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
    if (this.hud.modalOpen) vx = vy = 0;
    const len = Math.hypot(vx, vy) || 1;
    this.player.setVelocity((vx / len) * SPEED, (vy / len) * SPEED);

    const moving = Math.abs(vx) > 0.3 || Math.abs(vy) > 0.3;
    if (moving) this.facing = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
    this.pose(this.player, this.look, this.facing, moving);

    const [tx, ty] = this.target();
    this.cursor.setPosition(tx * TILE + 8, ty * TILE + 8);
    this.presence?.publish({ x: this.player.x, y: this.player.y, f: SHORT[this.facing], m: moving });
    this.updatePartners(dtMs);
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
      return;
    }
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
    const prop = propAt(x, y);
    if (prop?.id === 'bin') return this.run((s, ts) => ship(s, ts));
    if (prop?.id === 'stall') return this.hud.openShop(this.store.farm);
    if (prop?.id === 'sapling') return this.hud.toast(t('tree'));
    if (prop?.id === 'board') {
      if (!isUnlocked('orders', this.store.farm.xp)) return this.hud.toast(t('locked_orders'));
      return this.hud.openOrders(this.store.farm, now());
    }
    if (!isFieldTile(x, y)) return this.hud.toast(t('cant_farm'));
    const selected = this.selected;
    return this.run((s, ts) => useTile(s, x, y, selected, ts));
  }

  /** Runs one action through the store and reports it. One at a time. */
  private async run(action: (s: typeof this.store.farm, ts: number) => ActionResult) {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await this.store.apply(action);
      this.hud.toast(t(r.msg, r.vars));
      if (r.ok) this.refresh();
    } catch (e) {
      console.error(e);
      this.hud.toast(t('sync_error'));
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
    if (this.hud.shopOpen) this.hud.openShop(this.store.farm);
    if (this.hud.ordersOpen) this.hud.openOrders(this.store.farm, now());
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

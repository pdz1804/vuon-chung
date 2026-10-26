// The game controller: input, actions, refreshes and timers. It never draws;
// it tells a FarmView what to show and runs every action through the store.
import { now, vnHour } from '../clock';
import { t } from '../i18n';
import type { Pose, Presence } from '../net/presence';
import type { WorldStore } from '../net/world-store';
import { buyAnimal, fillFeeder, useAnimal } from '../sim/animals';
import { payout, ship, useTile, vnDay, buySeeds, type ActionResult, type FarmState } from '../sim/farm';
import { addMemory, readLetters, sendLetter, unreadFor } from '../sim/couple';
import { cook } from '../sim/kitchen';
import { deliverDuo, fulfill } from '../sim/orders';
import { ROLE_IDS, chooseRole, rankFor } from '../sim/roles';
import { UNLOCKS, isUnlocked, levelFor } from '../sim/progression';
import { rainingAt } from '../sim/weather';
import { SPECIES_IDS, type SpeciesId } from '../sim/species';
import { Hud, drawIcon } from '../ui/hud';
import { Panels } from '../ui/panels';
import { Tutorial } from '../ui/tutorial';
import { FishingPanel } from '../ui/fishing-panel';
import { castsLeft, landCatch } from '../sim/fishing';
import { disablePush, enablePush, pushStatus, touchDevice } from '../net/push';
import { isMuted, playSfx, setMuted, setNight, unlockAudio, type Sfx } from '../audio/sound';
import { PX_PER_TILE, type Facing, type FarmView } from './view';
import { ZONES, gateAt, isFieldTile, isPondTile, propAt, setOpenZones } from './world-map';
import { gatherMeadow } from '../sim/meadow';

/** Walking side by side with your partner is a little faster. */
const TOGETHER_BOOST = 1.25;
/** The only emotes the game sends or shows. */
export const EMOTES = ['❤️', '👋', '🌱', '😂'];
const CHICK_NAMES = ['Bông', 'Mít', 'Xôi', 'Na', 'Mochi', 'Bắp', 'Sữa', 'Kem'];
/** Which sound each successful action makes; anything unlisted gets a soft click. */
const SFX_FOR: Record<string, Sfx> = {
  tilled: 'till',
  planted: 'plant',
  watered: 'water',
  watered_both: 'water',
  harvested: 'harvest',
  shipped: 'coin',
  payout: 'coin',
  egg_collected: 'animal',
  feeder_filled: 'animal',
  animal_bought: 'animal',
  order_done: 'coin',
  duo_done: 'levelup',
  fish_caught: 'harvest',
  meadow_gathered: 'plant',
  fish_caught_duo: 'levelup',
  cooked: 'harvest',
  letter_sent: 'letter',
};
const SHORT: Record<Facing, Pose['f']> = { down: 'd', up: 'u', left: 'l', right: 'r' };

export interface GameBoot {
  store: WorldStore;
  isNew: boolean;
  hud: Hud;
  view: FarmView;
  /** Starts live avatar sync once the view can draw partners. */
  connectPresence?: (onPartner: (uid: string, pose: Pose | null) => void) => Presence;
}

export class GameController {
  private readonly store: WorldStore;
  private readonly hud: Hud;
  private readonly view: FarmView;
  private panels!: Panels;
  private presence?: Presence;
  private selected: SpeciesId = 'rau_muong';
  private busy = false;
  private level = 0;
  private readonly tutorial = new Tutorial();
  private readonly fishing = new FishingPanel();
  private unread = 0;
  private ranks = new Map<string, number>();
  private lastPayoutTry = 0;
  private lastClock = '';
  private wasRaining = false;
  private together = false;
  private togetherToastAt = -Infinity;
  private seenEmote = new Map<string, number>();
  private keys = new Set<string>();

  constructor(private boot: GameBoot) {
    this.store = boot.store;
    this.hud = boot.hud;
    this.view = boot.view;
  }

  async start(parent: HTMLElement) {
    const look = this.store.profiles[this.store.uid]?.look ?? 'phu';
    await this.view.mount(parent, look);
    this.presence = this.boot.connectPresence?.((uid, p) => this.onPartner(uid, p));
    this.bindInput();
    this.bindUi();
    this.store.onChange(() => this.refresh());
    this.refresh();
    if (this.boot.isNew) this.hud.toast(t('welcome'));
    this.tutorial.start(this.store.farm.xp);
    // Browsers only allow sound after a gesture, so the first one switches audio on.
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.showAwaySummary();

    this.view.onFrame((dt) => this.frame(dt));
    // Growth is derived from time, so the field only needs a redraw every second.
    setInterval(() => this.tick(), 1000);
    setInterval(() => this.store.flush(), 15_000);
    window.addEventListener('beforeunload', () => {
      this.store.flush();
      this.presence?.leave();
    });
    if (location.hash === '#qa') {
      Object.assign(window, {
        __qa: {
          controller: this,
          view: this.view,
          farm: () => this.store.farm,
          refresh: () => this.refresh(),
          partners: { size: () => this.view.partnerPositions().length },
        },
      });
    }
  }

  // ---------- input ----------

  private bindInput() {
    const move = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        this.hud.closeModals();
        this.panels.close();
        return;
      }
      if (this.typing() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (move.has(k)) {
        this.keys.add(k);
        e.preventDefault();
      } else if (k === ' ' || k === 'e') {
        e.preventDefault(); // no page scroll
        if (!e.repeat) void this.act();
      } else if (/^[1-9]$/.test(k) && !this.hud.modalOpen) {
        const id = SPECIES_IDS[Number(k) - 1];
        if (id) this.selectSeed(id);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Speaker button in the top bar; the choice is remembered on this device. */
  private labelMute() {
    const b = document.querySelector<HTMLButtonElement>('#mute')!;
    b.textContent = isMuted() ? '🔇' : '🔊';
    b.title = b.ariaLabel = t(isMuted() ? 'sound_off' : 'sound_on');
  }

  /** Notification bell: only in a shared garden on the deployed site, never asked unprompted. */
  private bindBell() {
    const b = document.querySelector<HTMLButtonElement>('#bell')!;
    if (!this.store.worldId || !import.meta.env.PROD || pushStatus() === 'unsupported') return;
    const label = () => {
      const st = pushStatus();
      b.textContent = st === 'on' ? '🔔' : '🔕';
      b.title = b.ariaLabel = t(`bell.${st}`);
    };
    b.hidden = false;
    label();
    touchDevice(this.store.uid);
    b.addEventListener('click', () => {
      const st = pushStatus();
      if (st === 'blocked' || st === 'install_first') return this.hud.toast(t(`bell.${st}`));
      const next = st === 'on' ? disablePush(this.store.uid) : enablePush(this.store.uid);
      void next
        .then((s) => this.hud.toast(t(s === 'on' ? 'bell.enabled' : s === 'off' ? 'bell.disabled' : `bell.${s}`)))
        .catch((e) => {
          console.error(e);
          this.hud.toast(t('sync_error'));
        })
        .finally(label);
    });
  }

  private bindUi() {
    this.bindBell();
    this.labelMute();
    document.querySelector('#mute')!.addEventListener('click', () => {
      setMuted(!isMuted());
      this.labelMute();
    });
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
      onLangChange: () => {
        this.refresh();
        this.tutorial.render();
        this.labelMute();
        touchDevice(this.store.uid);
      },
    });
  }

  /** True while a visible text field has focus: game keys must not steal keystrokes. */
  private typing(): boolean {
    const el = document.activeElement;
    return (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.offsetParent !== null;
  }

  // ---------- per frame ----------

  private frame(dt: number) {
    const k = this.keys;
    let vx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let vy = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (!vx && !vy) ({ x: vx, y: vy } = this.hud.stick);
    if (this.hud.modalOpen || this.typing()) vx = vy = 0;
    const moving = Math.abs(vx) > 0.3 || Math.abs(vy) > 0.3;
    this.view.move(vx, vy, dt, this.walkingTogether(moving) ? TOGETHER_BOOST : 1);
    const p = this.view.player;
    this.presence?.publish({ x: p.x * PX_PER_TILE, y: p.y * PX_PER_TILE, f: SHORT[p.facing], m: p.moving });
  }

  /** True while you and your partner walk side by side (one toast per stroll). */
  private walkingTogether(moving: boolean): boolean {
    const me = this.view.player;
    const partner = this.view.partnerPositions()[0];
    const dist = partner ? Math.hypot(partner.x - me.x, partner.y - me.y) : Infinity;
    // Enter at 1.5 tiles, leave at 2.25, so network jitter doesn't flicker the state.
    const near = !!partner && moving && partner.moving && dist < (this.together ? 2.25 : 1.5);
    if (near && !this.together && performance.now() - this.togetherToastAt > 15_000) {
      this.togetherToastAt = performance.now();
      this.hud.toast(t('walk_together'));
    }
    this.together = near;
    return near;
  }

  // ---------- partners and emotes ----------

  private onPartner(uid: string, p: Pose | null) {
    // Presence is in pixels (16 per tile); the view works in tiles.
    const pose = p ? { ...p, x: p.x / PX_PER_TILE, y: p.y / PX_PER_TILE } : null;
    this.view.partner(uid, pose, this.store.profiles[uid]);
    if (!p) return;
    // A newer emote from the partner: show it once (never replay an old one on join).
    if (p.e && EMOTES.includes(p.e) && p.et) {
      const seen = this.seenEmote.get(uid);
      if (seen !== undefined && p.et > seen) this.view.bubble(uid, p.e);
      this.seenEmote.set(uid, Math.max(seen ?? 0, p.et));
    } else if (!this.seenEmote.has(uid)) this.seenEmote.set(uid, 0);
  }

  private emote(e: string) {
    this.view.bubble('me', e);
    this.presence?.sendEmote(e);
  }

  // ---------- actions ----------

  private async act() {
    if (this.hud.modalOpen) return;
    const [x, y] = this.view.target();
    // Animals first: they stand on tiles that are otherwise free.
    const animal = this.view.animalAt(x, y);
    if (animal) return this.run((st, ts, uid) => useAnimal(st, animal, uid, ts), true);
    const farm = this.store.farm;
    const prop = propAt(x, y);
    if (prop?.id === 'house') {
      if (!isUnlocked('kitchen', farm.xp)) return this.hud.toast(t('locked_kitchen'));
      return this.panels.openKitchen(farm, drawIcon);
    }
    if (prop?.id === 'feeder') return this.run((s, ts, uid) => fillFeeder(s, ts, uid), true);
    if (prop?.id === 'coop' || prop?.id === 'stall') return this.hud.openShop(farm, this.store.uid);
    if (prop?.id === 'bin') return this.run((s, ts) => ship(s, ts), true);
    if (prop?.id === 'sapling') return this.panels.openTree(farm, this.names());
    if (prop?.id === 'mailbox') return this.panels.openMail(farm, this.store.uid, this.names());
    if (prop?.id === 'board') {
      if (!isUnlocked('orders', farm.xp)) return this.hud.toast(t('locked_orders'));
      return this.hud.openOrders(farm, now(), this.duoContext());
    }
    const gate = gateAt(x, y);
    if (gate && !isUnlocked(gate.id, farm.xp)) {
      const level = Object.entries(UNLOCKS).find(([, f]) => f.includes(gate.id))?.[0];
      return this.hud.toast(t(`locked_${gate.id}`, { n: level ?? '' }));
    }
    if (prop?.id === 'meadow') return this.run((s, ts) => gatherMeadow(s, ts), true);
    if (isPondTile(x, y)) {
      if (!isUnlocked('fishing', farm.xp)) return this.hud.toast(t('locked_fishing'));
      return this.fishing.open(castsLeft(farm, this.store.uid, now()), async () => {
        const r = await this.run((s, ts, uid) => landCatch(s, uid, ts));
        return !!r?.ok;
      });
    }
    if (!isFieldTile(x, y)) return this.hud.toast(t('cant_farm'));
    const selected = this.selected;
    return this.run((s, ts, uid) => useTile(s, x, y, selected, ts, uid), true);
  }

  /** Runs one action through the store and reports it. One at a time. */
  private async run(
    action: (s: FarmState, ts: number, uid: string) => ActionResult,
    animate = false,
  ): Promise<ActionResult | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const r = await this.store.apply(action);
      this.hud.toast(t(r.msg, r.vars));
      playSfx(r.ok ? (SFX_FOR[r.msg] ?? 'click') : 'error');
      if (r.ok) this.tutorial.notify(r.msg);
      if (r.ok) {
        if (animate) this.view.playAction();
        this.refresh();
      }
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

  // ---------- refresh ----------

  private refresh() {
    // Collision follows the unlocks: open gates let the farmer into new zones.
    setOpenZones(ZONES.filter((z) => isUnlocked(z.id, this.store.farm.xp)).map((z) => z.id));
    const farm = this.store.farm;
    // Level-ups can come from either partner, so detect them on every refresh.
    const lv = levelFor(farm.xp);
    if (this.level && lv > this.level) {
      const unlocks: string[] = [];
      for (let l = this.level + 1; l <= lv; l++) unlocks.push(...(UNLOCKS[l] ?? []).map((u) => t(`unlock.${u}`)));
      playSfx('levelup');
      this.hud.toast(t('level_up', { n: lv }) + (unlocks.length ? ` · ${unlocks.join(' · ')}` : ''));
      this.view.celebrate();
    }
    this.level = lv;
    this.view.drawFarm(farm, now(), this.store.uid);
    this.hud.render(farm, this.selected);
    if (this.hud.shopOpen) this.hud.openShop(farm, this.store.uid);
    if (this.hud.ordersOpen) this.hud.openOrders(farm, now(), this.duoContext());
    if (this.panels.mailOpen) this.panels.openMail(farm, this.store.uid, this.names());
    if (this.panels.treeOpen) this.panels.openTree(farm, this.names());
    if (this.panels.kitchenOpen) this.panels.openKitchen(farm, drawIcon);
    this.syncRoles();
    this.hud.showEmotes(this.store.members.length >= 2);
    const unread = unreadFor(farm, this.store.uid);
    if (unread > this.unread) {
      this.hud.toast(t('new_letter'));
      playSfx('letter');
    }
    this.unread = unread;
    this.tick();
  }

  private tick() {
    const ts = now();
    const farm = this.store.farm;
    // Pay the bin once the Vietnam day changed; the transaction makes it pay once
    // even if both partners open the game at midnight. One try a minute at most.
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
    this.view.drawFarm(farm, ts, this.store.uid);
    const h = vnHour(ts);
    // Darkness ramps 17–19h and 5–7h; fully dark overnight.
    const dark = h >= 19 || h < 5 ? 1 : h >= 17 ? (h - 17) / 2 : h < 7 ? (7 - h) / 2 : 0;
    const raining = rainingAt(ts);
    this.view.setEnvironment(dark, raining);
    setNight(dark > 0.5);
    const clock = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    if (clock !== this.lastClock || raining !== this.wasRaining) this.hud.setClock((this.lastClock = clock), raining);
    if (raining !== this.wasRaining) {
      this.wasRaining = raining;
      if (raining) this.hud.toast(t('raining'));
    }
  }

  /** Roles button (from level 3), live dialog refresh, and a toast on rank-ups. */
  private syncRoles() {
    const farm = this.store.farm;
    const btn = document.querySelector<HTMLButtonElement>('#roles-btn')!;
    btn.hidden = !isUnlocked('roles', farm.xp);
    const me = farm.players[this.store.uid];
    const icon = { grower: '🌾', rancher: '🐔', florist: '🌸' } as const;
    btn.textContent = me?.role ? `${icon[me.role]} ${Math.floor(rankFor(me.roleXp[me.role] ?? 0))}★` : '🧑‍🌾';
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
    if (since) {
      this.panels.openAway(this.store.farm, this.store.uid, since, this.store.profiles[partner ?? '']?.name ?? '♥');
    }
    const mark = () => {
      try {
        localStorage.setItem(key, String(now()));
      } catch {
        /* ignore */
      }
    };
    mark();
    setInterval(mark, 30_000);
    window.addEventListener('beforeunload', mark);
  }
}

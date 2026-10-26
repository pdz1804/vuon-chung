// DOM overlay: status bar, seed hotbar, bag, toasts, shop, and touch controls.
// DOM (not canvas) so text stays crisp and Vietnamese diacritics render properly.
import { getLang, setLang, t } from '../i18n';
import { bondLevel } from '../sim/milestones';
import { FESTIVAL_ORDER, festivalAt, festivalDelivered } from '../sim/festival';
import { binValue, seedPrice, speciesUnlocked, vnDay, type FarmState } from '../sim/farm';
import { ANIMALS, ANIMAL_IDS, type AnimalSpecies } from '../sim/animals';
import { boardFor, doneToday, duoDelivered, duoFor, haveCount } from '../sim/orders';
import { isUnlocked } from '../sim/progression';
import { UNLOCKS, levelFor, levelProgress } from '../sim/progression';
import { SPECIES, SPECIES_IDS, type SpeciesId } from '../sim/species';

export interface HudHandlers {
  onSelectSeed(id: SpeciesId): void;
  onAction(): void;
  onBuy(id: SpeciesId, n: number): void;
  onDeliver(idx: number): void;
  onDeliverDuo(): void;
  onDeliverFestival(): void;
  onBuyAnimal(species: AnimalSpecies): void;
  onEmote(e: string): void;
  onLangChange(): void;
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export class Hud {
  /** Joystick vector, -1..1 on each axis. */
  stick = { x: 0, y: 0 };
  private toastTimer = 0;

  private h: HudHandlers = {
    onSelectSeed: () => {},
    onAction: () => {},
    onBuy: () => {},
    onDeliver: () => {},
    onDeliverDuo: () => {},
    onDeliverFestival: () => {},
    onBuyAnimal: () => {},
    onEmote: () => {},
    onLangChange: () => {},
  };

  /** Connects the HUD to the running scene. */
  bind(h: HudHandlers) {
    this.h = h;
  }

  constructor() {
    $('#lang').addEventListener('click', () => {
      setLang(getLang() === 'vi' ? 'en' : 'vi');
      this.h.onLangChange();
    });
    $('#act').addEventListener('click', (e) => {
      e.preventDefault();
      this.h.onAction();
    });
    // Swallow the tail of the tap that opened a dialog (ghost clicks on phones):
    // a click whose press began before the dialog appeared is not aimed at it.
    let downAt = 0;
    document.addEventListener('pointerdown', () => (downAt = performance.now()), true);
    document.addEventListener(
      'click',
      (e) => {
        const modal = (e.target as HTMLElement | null)?.closest('.modal');
        // Keyboard and assistive-tech activations have detail 0 and are always intended.
        const fromPointer = e.detail > 0;
        if (fromPointer && modal && downAt < Number((modal as HTMLElement).dataset.openedAt ?? 0)) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true,
    );
    new MutationObserver((list) => {
      for (const m of list) {
        const el = m.target as HTMLElement;
        if (!el.hidden) el.dataset.openedAt = String(performance.now());
      }
    }).observe(document.querySelector('#ui')!, { subtree: true, attributeFilter: ['hidden'] });
    $('#shop-close').addEventListener('click', () => this.closeShop());
    $('#orders-close').addEventListener('click', () => ($('#orders').hidden = true));
    // Escape closes the open dialog through its own close button, so each dialog's
    // close logic still runs. The lobby has no close button and stays open.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = document.querySelector<HTMLElement>('#ui .modal:not([hidden]):not(.lobby)');
      open?.querySelector<HTMLButtonElement>('[id$="-close"]')?.click();
    });
    this.bindStick();
    for (const b of document.querySelectorAll<HTMLButtonElement>('#emotes button')) {
      b.addEventListener('click', () => this.h.onEmote(b.dataset.e!));
    }
  }

  /** Emotes only make sense with a partner in the garden. */
  showEmotes(on: boolean) {
    $('#emotes').hidden = !on;
  }

  get shopOpen() {
    return !$('#shop').hidden;
  }

  get ordersOpen() {
    return !$('#orders').hidden;
  }

  /** True while any dialog covers the game, so the farmer stands still. */
  get modalOpen() {
    return !!document.querySelector('.modal:not([hidden])');
  }

  setClock(clock: string, raining: boolean) {
    $('#clock').textContent = `${clock} ${raining ? '🌧️' : ''}`.trim();
  }

  /** Rebuilds the HUD; call after a state change, not every frame. */
  render(s: FarmState, selected: SpeciesId) {
    $('#coins').textContent = `${s.coins} ${t('coins')}`;
    const lv = levelFor(s.xp);
    $('#xp').innerHTML = `♥ ${t('level', { n: lv })}<i style="--p:${Math.round(levelProgress(s.xp) * 100)}%"></i>`;
    $('#xp').title = `XP ${s.xp}`;
    const bond = s.bond?.points ?? 0;
    $('#bond').textContent = `💞 ${bondLevel(bond)}`;
    $('#bond').title = t('bond_title', { n: bondLevel(bond), p: bond });
    $('#lang').textContent = getLang() === 'vi' ? 'EN' : 'VI';
    $('#act').textContent = t('action');
    $('#help').textContent = t('help');
    const pending = binValue(s.bin);
    $('#binval').textContent = pending ? `${t('bin')}: ≈${pending} ${t('coins')}` : '';

    const bar = $('#hotbar');
    bar.replaceChildren(
      ...SPECIES_IDS.map((id, i) => {
        const b = document.createElement('button');
        const locked = !speciesUnlocked(id, s.xp);
        b.className = 'slot' + (id === selected ? ' on' : '') + (locked ? ' locked' : '');
        b.innerHTML = `<span class="k">${i + 1}</span><canvas width="16" height="16"></canvas><span class="c">${s.seeds[id] ?? 0}</span>`;
        b.title = t(`sp.${id}`);
        b.setAttribute('aria-label', `${t(`sp.${id}`)} ×${s.seeds[id] ?? 0}`);
        b.addEventListener('click', () => this.h.onSelectSeed(id));
        drawIcon(b.querySelector('canvas')!, id);
        return b;
      }),
    );

    const bag = Object.entries(s.produce).filter(([, n]) => n > 0);
    $('#bag').innerHTML =
      `<b>${t('bag')}</b> ` +
      (bag.length
        ? bag
            .map(([item, n]) => {
              const [id, stars] = item.split(':');
              return `<span>${t(`sp.${id}`)} ${'★'.repeat(Number(stars))} ×${n}</span>`;
            })
            .join('')
        : `<span class="muted">${t('empty_bag')}</span>`);
  }

  toast(msg: string) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
  }

  openShop(s: FarmState, uid = 'local') {
    $('#shop-title').textContent = t('shop');
    $('#shop-close').textContent = t('close');
    $('#shop-list').replaceChildren(
      ...SPECIES_IDS.map((id) => {
        const row = document.createElement('div');
        row.className = 'shop-row';
        const sp = SPECIES[id];
        const locked = !speciesUnlocked(id, s.xp);
        const unlockLv = Object.entries(UNLOCKS).find(([, f]) => sp.unlock && f.includes(sp.unlock))?.[0];
        const price = locked ? t('locked_at', { n: unlockLv ?? '?' }) : `${seedPrice(s, id, uid)} ${t('coins')}`;
        row.innerHTML = `<canvas width="16" height="16"></canvas><span class="nm">${t(`sp.${id}`)}<small>${price}</small></span>`;
        drawIcon(row.querySelector('canvas')!, id);
        if (locked) row.classList.add('locked');
        for (const n of locked ? [] : [1, 5]) {
          const b = document.createElement('button');
          b.textContent = `${t('buy')} ×${n}`;
          b.disabled = s.coins < seedPrice(s, id, uid) * n;
          b.addEventListener('click', () => this.h.onBuy(id, n));
          row.append(b);
        }
        return row;
      }),
      ...ANIMAL_IDS.map((sp) => this.animalRow(s, sp)),
    );
    $('#shop').hidden = false;
  }

  closeShop() {
    $('#shop').hidden = true;
  }

  closeModals() {
    $('#shop').hidden = true;
    $('#orders').hidden = true;
  }

  private animalRow(s: FarmState, species: AnimalSpecies) {
    const row = document.createElement('div');
    row.className = 'shop-row';
    const spec = ANIMALS[species];
    const locked = !isUnlocked(spec.unlock, s.xp);
    const owned = s.animals.filter((a) => a.species === species).length;
    const lv = Object.entries(UNLOCKS).find(([, f]) => f.includes(spec.unlock))?.[0] ?? '?';
    const note = locked ? t('locked_at', { n: lv }) : `${spec.cost} ${t('coins')} · ${owned}/${spec.capacity}`;
    row.innerHTML = `<canvas width="16" height="16"></canvas><span class="nm">${t(`baby.${species}`)}<small>${note}</small></span>`;
    drawIcon(row.querySelector('canvas')!, `${species}_0`);
    if (locked) row.classList.add('locked');
    else {
      const b = document.createElement('button');
      b.textContent = t('buy');
      b.disabled = s.coins < spec.cost || owned >= spec.capacity;
      b.addEventListener('click', () => this.h.onBuyAnimal(species));
      row.append(b);
    }
    return row;
  }

  /** The village board: today's three orders with a Deliver button each. */
  openOrders(s: FarmState, now: number, duo?: { uid: string; names: Record<string, string> }) {
    $('#orders-title').textContent = t('orders_title');
    $('#orders-close').textContent = t('close');
    const done = doneToday(s, now);
    $('#orders-list').replaceChildren(
      ...boardFor(s, now).map((o, i) => {
        const row = document.createElement('div');
        row.className = 'shop-row';
        const have = Math.min(haveCount(s, o.species), o.count);
        row.innerHTML = `<canvas width="16" height="16"></canvas><span class="nm">${t(`sp.${o.species}`)} ×${o.count}<small>${have}/${o.count} · +${o.coins} ${t('coins')} · +${o.xp} XP</small></span>`;
        drawIcon(row.querySelector('canvas')!, o.species);
        const b = document.createElement('button');
        b.textContent = done.includes(i) ? '✓' : t('deliver');
        b.disabled = done.includes(i) || have < o.count;
        b.addEventListener('click', () => this.h.onDeliver(i));
        row.append(b);
        return row;
      }),
    );
    if (duo) $('#orders-list').append(this.duoRow(s, now, duo.uid, duo.names));
    if (duo && festivalAt(now)) $('#orders-list').append(this.festivalRow(s, now, duo.uid, duo.names));
    $('#orders').hidden = false;
  }

  /** The daily duo order: each partner hands in their half. */
  private duoRow(s: FarmState, now: number, uid: string, names: Record<string, string>) {
    const o = duoFor(vnDay(now), s.duo?.day === vnDay(now) ? s.duo.xp : s.xp);
    const by = duoDelivered(s, now);
    const row = document.createElement('div');
    row.className = 'shop-row duo';
    const status = Object.entries(names)
      .map(([u, n]) => `${n} ${by.includes(u) ? '✓' : '…'}`)
      .join(' · ');
    const have = Math.min(haveCount(s, o.species), o.count);
    row.innerHTML = `<canvas width="16" height="16"></canvas><span class="nm">✋✋ ${t(`sp.${o.species}`)} ×${o.count} ${t('each')}<small></small></span>`;
    row.querySelector('small')!.textContent = `${status} · +${o.coins} ${t('coins')} · +${o.xp} XP`;
    drawIcon(row.querySelector('canvas')!, o.species);
    const b = document.createElement('button');
    const done = by.length >= 2;
    b.textContent = done ? '✓' : by.includes(uid) ? '⏳' : t('deliver');
    b.disabled = done || by.includes(uid) || have < o.count;
    b.addEventListener('click', () => this.h.onDeliverDuo());
    row.append(b);
    return row;
  }

  /** The festival order: like the duo order, but paid once per festival. */
  private festivalRow(s: FarmState, now: number, uid: string, names: Record<string, string>) {
    const f = festivalAt(now)!;
    const o = FESTIVAL_ORDER[f.kind];
    const by = festivalDelivered(s, now);
    const row = document.createElement('div');
    row.className = 'shop-row duo festival';
    const status = Object.entries(names)
      .map(([u, n]) => `${n} ${by.includes(u) ? '✓' : '…'}`)
      .join(' · ');
    const have = Math.min(haveCount(s, o.species), o.count);
    row.innerHTML = `<canvas width="16" height="16"></canvas><span class="nm"></span>`;
    const nm = row.querySelector('.nm')!;
    nm.textContent = `${t(`festival.${f.kind}`)} · ${t(`sp.${o.species}`)} ×${o.count} ${t('each')}`;
    const small = document.createElement('small');
    small.textContent = `${status} · +${o.coins} ${t('coins')} · +${o.xp} XP`;
    nm.append(small);
    row.title = t('festival_note');
    drawIcon(row.querySelector('canvas')!, o.species);
    const b = document.createElement('button');
    const done = by.length >= 2;
    b.textContent = done ? '✓' : by.includes(uid) ? '⏳' : t('deliver');
    b.disabled = done || by.includes(uid) || have < o.count;
    b.addEventListener('click', () => this.h.onDeliverFestival());
    row.append(b);
    return row;
  }

  private bindStick() {
    const pad = $('#stick');
    const knob = $('#knob');
    let id: number | null = null;
    const move = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const max = r.width / 2;
      const len = Math.min(max, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      knob.style.transform = `translate(${Math.cos(a) * len}px, ${Math.sin(a) * len}px)`;
      this.stick = len < 8 ? { x: 0, y: 0 } : { x: Math.cos(a), y: Math.sin(a) };
    };
    pad.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      pad.setPointerCapture(id);
      move(e);
    });
    pad.addEventListener('pointermove', (e) => e.pointerId === id && move(e));
    const end = () => {
      id = null;
      this.stick = { x: 0, y: 0 };
      knob.style.transform = '';
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
  }
}

/** Copies the ready-stage crop texture into a hotbar icon. */
let iconSource: ((id: string) => HTMLCanvasElement | null) | null = null;
/** `id` is a crop or product id (drawn from its ready texture) or a texture key. */
export function setIconSource(fn: (id: string) => HTMLCanvasElement | null) {
  iconSource = fn;
}
export function drawIcon(cv: HTMLCanvasElement, id: string) {
  const src = iconSource?.(id);
  if (src) cv.getContext('2d')!.drawImage(src, 0, 0, cv.width, cv.height);
}

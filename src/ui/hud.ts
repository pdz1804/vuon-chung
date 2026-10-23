// DOM overlay: status bar, seed hotbar, bag, toasts, shop, and touch controls.
// DOM (not canvas) so text stays crisp and Vietnamese diacritics render properly.
import { getLang, setLang, t } from '../i18n';
import { binValue, type FarmState } from '../sim/farm';
import { SPECIES, SPECIES_IDS, type SpeciesId } from '../sim/species';

export interface HudHandlers {
  onSelectSeed(id: SpeciesId): void;
  onAction(): void;
  onBuy(id: SpeciesId, n: number): void;
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
    $('#act').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.h.onAction();
    });
    $('#shop-close').addEventListener('click', () => this.closeShop());
    this.bindStick();
  }

  get shopOpen() {
    return !$('#shop').hidden;
  }

  /** True while any dialog covers the game, so the farmer stands still. */
  get modalOpen() {
    return !!document.querySelector('.modal:not([hidden])');
  }

  setClock(clock: string) {
    $('#clock').textContent = clock;
  }

  /** Rebuilds the HUD; call after a state change, not every frame. */
  render(s: FarmState, selected: SpeciesId) {
    $('#coins').textContent = `${s.coins} ${t('coins')}`;
    $('#xp').textContent = `XP ${s.xp}`;
    $('#lang').textContent = getLang() === 'vi' ? 'EN' : 'VI';
    $('#act').textContent = t('action');
    $('#help').textContent = t('help');
    const pending = binValue(s.bin);
    $('#binval').textContent = pending ? `${t('bin')}: ≈${pending} ${t('coins')}` : '';

    const bar = $('#hotbar');
    bar.replaceChildren(
      ...SPECIES_IDS.map((id, i) => {
        const b = document.createElement('button');
        b.className = 'slot' + (id === selected ? ' on' : '');
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

  openShop(s: FarmState) {
    $('#shop-title').textContent = t('shop');
    $('#shop-close').textContent = t('close');
    $('#shop-list').replaceChildren(
      ...SPECIES_IDS.map((id) => {
        const row = document.createElement('div');
        row.className = 'shop-row';
        const sp = SPECIES[id];
        row.innerHTML = `<canvas width="16" height="16"></canvas><span class="nm">${t(`sp.${id}`)}<small>${sp.seedCost} ${t('coins')}</small></span>`;
        drawIcon(row.querySelector('canvas')!, id);
        for (const n of [1, 5]) {
          const b = document.createElement('button');
          b.textContent = `${t('buy')} ×${n}`;
          b.disabled = s.coins < sp.seedCost * n;
          b.addEventListener('click', () => this.h.onBuy(id, n));
          row.append(b);
        }
        return row;
      }),
    );
    $('#shop').hidden = false;
  }

  closeShop() {
    $('#shop').hidden = true;
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
let iconSource: ((id: SpeciesId) => HTMLCanvasElement | null) | null = null;
export function setIconSource(fn: (id: SpeciesId) => HTMLCanvasElement | null) {
  iconSource = fn;
}
function drawIcon(cv: HTMLCanvasElement, id: SpeciesId) {
  const src = iconSource?.(id);
  if (src) cv.getContext('2d')!.drawImage(src, 0, 0);
}

// The fishing card: cast, wait for the bite, then reel within a short window.
// Timing runs locally so network lag never costs a catch; only a catch is saved.
import { t } from '../i18n';

/** The bite comes 1.1–2.3 s after casting; the reel window is 0.7 s. */
const BITE_MIN_MS = 1100;
const BITE_SPREAD_MS = 1200;
const REEL_WINDOW_MS = 700;

type Phase = 'idle' | 'waiting' | 'bite' | 'saving';

export class FishingPanel {
  private readonly root = document.querySelector<HTMLElement>('#fish')!;
  private readonly status = this.root.querySelector<HTMLElement>('#fish-status')!;
  private readonly btn = this.root.querySelector<HTMLButtonElement>('#fish-btn')!;
  private readonly bobber = this.root.querySelector<HTMLElement>('#fish-bobber')!;
  private phase: Phase = 'idle';
  private timer = 0;
  private left = 0;
  /** Bumped on every open/close so a late save result from an old session is ignored. */
  private session = 0;
  private onCatch: () => Promise<boolean> = () => Promise.resolve(false);

  constructor() {
    this.btn.addEventListener('click', () => this.press());
    this.root.querySelector('#fish-close')!.addEventListener('click', () => this.close());
  }

  /** Opens the card. `onCatch` saves one catch and resolves true when it was recorded. */
  open(castsLeft: number, onCatch: () => Promise<boolean>) {
    this.session++;
    this.left = castsLeft;
    this.onCatch = onCatch;
    this.root.querySelector('h2')!.textContent = t('fish_title');
    this.root.querySelector<HTMLButtonElement>('#fish-close')!.textContent = t('close');
    this.idle(t(castsLeft > 0 ? 'fish_ready' : 'fish_tired'));
    this.root.hidden = false;
    this.btn.focus();
  }

  close() {
    this.session++;
    clearTimeout(this.timer);
    this.phase = 'idle';
    this.root.hidden = true;
  }

  private idle(msg: string) {
    this.phase = 'idle';
    this.status.textContent = `${msg} · ${t('fish_left', { n: this.left })}`;
    this.btn.textContent = t('fish_cast');
    this.btn.disabled = this.left <= 0;
    this.bobber.className = '';
  }

  private press() {
    if (this.phase === 'idle') return this.cast();
    if (this.phase === 'waiting') {
      clearTimeout(this.timer);
      return this.idle(t('fish_early'));
    }
    if (this.phase === 'bite') return void this.reel();
  }

  private cast() {
    this.phase = 'waiting';
    this.status.textContent = t('fish_wait');
    this.btn.textContent = t('fish_reel');
    this.bobber.className = 'cast';
    this.timer = window.setTimeout(() => this.bite(), BITE_MIN_MS + Math.random() * BITE_SPREAD_MS);
  }

  private bite() {
    this.phase = 'bite';
    this.status.textContent = t('fish_bite');
    this.bobber.className = 'bite';
    this.timer = window.setTimeout(() => this.idle(t('fish_missed')), REEL_WINDOW_MS);
  }

  private async reel() {
    clearTimeout(this.timer);
    this.phase = 'saving';
    this.btn.disabled = true;
    const session = this.session;
    const ok = await this.onCatch().catch(() => false);
    if (session !== this.session) return;
    if (ok) this.left -= 1;
    this.idle(t(ok ? 'fish_again' : 'fish_missed'));
  }
}

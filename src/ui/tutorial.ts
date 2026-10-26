// First-time coach card: six short steps, each advanced by the matching game action.
// It shows once per device, only in a garden that has no XP yet, and can be skipped.
import { t } from '../i18n';

const DONE_KEY = 'vuon-chung:tutorial:v1:complete';
const STEP_KEY = 'vuon-chung:tutorial:v1:step';
/** Each step lists the action results (ActionResult.msg) that complete it. */
const STEPS: Array<{ key: string; done: string[] }> = [
  { key: 'tut.move', done: ['moved'] },
  { key: 'tut.till', done: ['tilled'] },
  { key: 'tut.plant', done: ['planted'] },
  { key: 'tut.water', done: ['watered', 'watered_both'] },
  { key: 'tut.harvest', done: ['harvested'] },
  { key: 'tut.ship', done: ['shipped'] },
];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: progress just isn't remembered.
  }
}

function stored(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1';
  } catch {
    return true; // No storage: don't nag on every visit.
  }
}

export class Tutorial {
  private step = -1;
  private readonly el = document.querySelector<HTMLElement>('#coach')!;

  /** Starts the tour if this device hasn't finished it and the garden is brand new. */
  start(gardenXp: number) {
    // A tour already under way resumes even after the first harvest gave the garden XP.
    if (stored() || (gardenXp > 0 && read(STEP_KEY) === null)) return;
    this.step = Math.min(Number(read(STEP_KEY)) || 0, STEPS.length - 1);
    this.el.querySelector('button')!.addEventListener('click', () => this.finish());
    const moved = () => this.notify('moved');
    window.addEventListener('keydown', (e) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (!typing && /^(Arrow|Key[WASD]$)/.test(e.code)) moved();
    });
    document.querySelector('#stick')?.addEventListener('pointerdown', moved);
    this.render();
  }

  /** Feed every action result here. A player who does a later step early skips ahead. */
  notify(msg: string) {
    if (this.step < 0 || this.step >= STEPS.length) return;
    const hit = STEPS.findIndex((st, i) => i >= this.step && st.done.includes(msg));
    if (hit < 0) return;
    this.step = hit + 1;
    if (this.step >= STEPS.length) return this.finish();
    write(STEP_KEY, String(this.step));
    this.render();
  }

  /** Re-renders the text after a language switch. */
  render() {
    const cur = STEPS[this.step];
    this.el.hidden = !cur;
    if (!cur) return;
    this.el.querySelector('p')!.textContent = t(cur.key);
    this.el.querySelector('small')!.textContent = `${this.step + 1}/${STEPS.length}`;
    this.el.querySelector('button')!.textContent = t('tut.skip');
  }

  private finish() {
    this.step = STEPS.length;
    this.el.hidden = true;
    write(DONE_KEY, '1');
  }
}

// First-time coach card: six short steps, each advanced by the matching game action.
// It shows once per device, only in a garden that has no XP yet, and can be skipped.
import { t } from '../i18n';

const DONE_KEY = 'vuon-chung:tutorial:v1:complete';
/** Each step lists the action results (ActionResult.msg) that complete it. */
const STEPS: Array<{ key: string; done: string[] }> = [
  { key: 'tut.move', done: ['moved'] },
  { key: 'tut.till', done: ['tilled'] },
  { key: 'tut.plant', done: ['planted'] },
  { key: 'tut.water', done: ['watered', 'watered_both'] },
  { key: 'tut.harvest', done: ['harvested'] },
  { key: 'tut.ship', done: ['shipped'] },
];

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
    if (stored() || gardenXp > 0) return;
    this.step = 0;
    this.el.querySelector('button')!.addEventListener('click', () => this.finish());
    const moved = () => this.notify('moved');
    window.addEventListener('keydown', (e) => {
      if (/^(Arrow|Key[WASD]$)/.test(e.code)) moved();
    });
    document.querySelector('#stick')?.addEventListener('pointerdown', moved);
    this.render();
  }

  /** Feed every action result here; the current step advances when it matches. */
  notify(msg: string) {
    const cur = STEPS[this.step];
    if (!cur || !cur.done.includes(msg)) return;
    this.step++;
    if (this.step >= STEPS.length) this.finish();
    else this.render();
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
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {
      // Private mode: the tour simply may show again next visit.
    }
  }
}

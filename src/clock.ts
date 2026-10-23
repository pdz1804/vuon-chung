// Game clock. Real time by default. `?speed=600` runs a fast dev clock
// (10 game-minutes per real second) with its own save slot, so testing never
// pollutes the real farm.
const params = new URLSearchParams(location.search);
export const SPEED = Math.max(1, Number(params.get('speed')) || 1);
export const DEV = SPEED !== 1;
const DEV_KEY = 'vuon-chung:dev-clock';

let base = Date.now();
const realStart = Date.now();
if (DEV) {
  try {
    base = Number(localStorage.getItem(DEV_KEY)) || base;
  } catch {
    /* ignore */
  }
}

export function now(): number {
  return base + (Date.now() - realStart) * SPEED;
}

export function persistClock() {
  if (!DEV) return;
  try {
    localStorage.setItem(DEV_KEY, String(now()));
  } catch {
    /* ignore */
  }
}

/** Hour of day in Vietnam (0–24, fractional). */
export function vnHour(ts = now()): number {
  const d = new Date(ts + 7 * 3_600_000);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

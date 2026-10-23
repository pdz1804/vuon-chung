// Local save for the solo prototype. Phase 2 replaces this with the shared Firestore world.
import { DEV, persistClock } from './clock';
import { migrate, newFarm, type FarmState } from './sim/farm';

const KEY = DEV ? 'vuon-chung:farm-dev' : 'vuon-chung:farm';

export function loadFarm(): { farm: FarmState; isNew: boolean } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { farm: migrate(JSON.parse(raw)), isNew: false };
  } catch {
    /* corrupt or blocked storage: start fresh */
  }
  return { farm: newFarm(), isNew: true };
}

export function saveFarm(farm: FarmState) {
  persistClock();
  try {
    localStorage.setItem(KEY, JSON.stringify(farm));
  } catch {
    /* ignore */
  }
}

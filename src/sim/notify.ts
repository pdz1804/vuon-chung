// Push-notification rules shared by the game and the notifier Cloud Function: which
// partner actions are worth a notification, what it says, quiet hours and reminders.
// Pure functions only, so the server bundles this file without any browser code.
import type { FeedEvent } from './couple';
import { plotState, type FarmState } from './farm';

export type Lang = 'vi' | 'en';
/** Partner actions that notify the other player. Watering is too frequent to notify. */
export const NOTIFY_MSGS = ['letter_sent', 'harvested', 'memory_added'] as const;
/** At most this many partner-action notifications per person per Vietnam day. */
export const DAILY_ACTION_LIMIT = 6;
const VN_OFFSET_MS = 7 * 3_600_000;

const COPY: Record<Lang, Record<string, string>> = {
  vi: {
    letter_sent: '{name} vừa gửi bạn một lá thư 💌',
    harvested: '{name} vừa thu hoạch trong vườn 🌾',
    memory_added: '{name} vừa treo một kỷ niệm lên Cây Ký Ức 🌳',
    ready: 'Có cây đã chín, ra vườn thu hoạch thôi 🌱',
    thirsty: 'Vườn đang khát nước, ghé tưới cây nhé 💧',
  },
  en: {
    letter_sent: '{name} sent you a letter 💌',
    harvested: '{name} harvested in your garden 🌾',
    memory_added: '{name} hung a memory on the Memory Tree 🌳',
    ready: 'Some crops are ready to harvest 🌱',
    thirsty: 'Your garden is thirsty — come water it 💧',
  },
};

/** Stable identity of a feed event (the feed has no ids). */
export function eventKey(e: FeedEvent): string {
  return `${e.t}_${e.uid}_${e.msg}`;
}

/** Notify-worthy events present in `after` but not in `before`. */
export function newNotifyEvents(before: FeedEvent[], after: FeedEvent[]): FeedEvent[] {
  const seen = new Set(before.map(eventKey));
  return after.filter((e) => !seen.has(eventKey(e)) && (NOTIFY_MSGS as readonly string[]).includes(e.msg));
}

/** Notification text. Letter contents never appear in a notification. */
export function notificationText(kind: string, lang: Lang, partnerName = ''): { title: string; body: string } {
  const body = (COPY[lang][kind] ?? COPY[lang].ready).replace(
    '{name}',
    partnerName || (lang === 'vi' ? 'Người ấy' : 'Your partner'),
  );
  return { title: 'Vườn Chung', body };
}

/** No notifications from 22:00 to 07:30 Vietnam time. */
export function isQuietHour(ts: number): boolean {
  const d = new Date(ts + VN_OFFSET_MS);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return h >= 22 || h < 7.5;
}

/** A farm reminder worth sending now, or null: ready crops beat thirsty ones. */
export function reminderFor(farm: FarmState, ts: number): 'ready' | 'thirsty' | null {
  let thirsty = false;
  for (const plot of Object.values(farm.plots ?? {})) {
    const st = plotState(plot, ts);
    if (st === 'ready') return 'ready';
    if (st === 'needs_water') thirsty = true;
  }
  return thirsty ? 'thirsty' : null;
}

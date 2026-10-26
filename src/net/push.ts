// Opt-in push notifications. Nothing is asked at launch: the player taps the bell,
// which requests permission and stores this device's FCM token under
// users/{uid}/devices/{deviceId}. The notifier Cloud Function reads it from there.
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { getLang } from '../i18n';
import { app, db } from './firebase';

const DEVICE_KEY = 'vuon-chung:device-id';

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'shared-device';
  }
}

/** iPhone/iPad only allow web push for a game installed to the Home Screen. */
function isIosBrowserTab(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone && !matchMedia('(display-mode: standalone)').matches;
}

export type PushStatus = 'unsupported' | 'install_first' | 'off' | 'on' | 'blocked';

export function pushStatus(): PushStatus {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIosBrowserTab() ? 'install_first' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission === 'granted' && onFlag() === '1') return 'on';
  return 'off';
}

/** The bell's "on" flag is per account, so a shared browser never mixes two people. */
let currentUid = '';
function onFlag(): string | null {
  try {
    return localStorage.getItem(`${DEVICE_KEY}:on:${currentUid}`);
  } catch {
    return null;
  }
}
function setOnFlag(on: boolean) {
  try {
    if (on) localStorage.setItem(`${DEVICE_KEY}:on:${currentUid}`, '1');
    else localStorage.removeItem(`${DEVICE_KEY}:on:${currentUid}`);
  } catch {
    // Private mode: the bell just shows off next time.
  }
}

/** Asks for permission (must run from a tap) and registers this device's token. */
export async function enablePush(uid: string): Promise<PushStatus> {
  currentUid = uid;
  if (pushStatus() === 'unsupported' || pushStatus() === 'install_first') return pushStatus();
  if ((await Notification.requestPermission()) !== 'granted') return pushStatus();
  const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
  if (!(await isSupported())) return 'unsupported';
  const token = await getToken(getMessaging(app), {
    serviceWorkerRegistration: await navigator.serviceWorker.ready,
  });
  await setDoc(doc(db, 'users', uid, 'devices', deviceId()), {
    token,
    enabled: true,
    lang: getLang(),
    platform: 'web',
    lastSeenAt: Date.now(),
  });
  setOnFlag(true);
  return 'on';
}

export async function disablePush(uid: string): Promise<PushStatus> {
  currentUid = uid;
  setOnFlag(false);
  await updateDoc(doc(db, 'users', uid, 'devices', deviceId()), { enabled: false }).catch(() => {});
  return pushStatus();
}

/** Which account the bell belongs to; call once the player is signed in. */
export function usePushAccount(uid: string) {
  currentUid = uid;
}

/** Tells the notifier this device is in the game now (no reminder needed) and its language. */
export function touchDevice(uid: string) {
  currentUid = uid;
  if (pushStatus() !== 'on') return;
  void updateDoc(doc(db, 'users', uid, 'devices', deviceId()), { lastSeenAt: Date.now(), lang: getLang() }).catch(
    () => {},
  );
}

/**
 * At game start with the bell on: fetch the current token and store it enabled again,
 * in case it rotated or the notifier switched this device off. Permission is already
 * granted, so no prompt appears.
 */
export function refreshDevice(uid: string) {
  currentUid = uid;
  if (pushStatus() === 'on') void enablePush(uid).catch(() => setOnFlag(false));
}

// Lobby: sign in, then open your garden, create one, or join your partner's
// with an invite link (?join=CODE). Resolves with a ready SharedStore.
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  type User,
} from 'firebase/auth';
import { renderIcon } from '../game/icons';
import { t } from '../i18n';
import { EMULATORS, auth } from '../net/firebase';
import {
  SharedStore,
  createInvite,
  createWorld,
  myRooms,
  rememberRoom,
  roomSummary,
  type RoomSummary,
  joinWithInvite,
  syncServerClock,
  type Look,
} from '../net/world-store';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

export interface LobbyResult {
  store: SharedStore;
  isNew: boolean;
}

/** Shows one lobby panel and fills its text. */
function show(panel: string) {
  $('#lobby').hidden = false;
  $('#lobby-error').textContent = '';
  for (const el of document.querySelectorAll<HTMLElement>('#lobby [data-panel]'))
    el.hidden = el.dataset.panel !== panel;
  for (const el of document.querySelectorAll<HTMLElement>('#lobby [data-t]')) el.textContent = t(el.dataset.t!);
}

function error(e: unknown) {
  const code = e instanceof Error ? e.message : String(e);
  console.error(e);
  $('#lobby-error').textContent = t(
    code === 'invite_own'
      ? 'invite_own'
      : code.includes('invite') || code.includes('permission')
        ? 'invite_invalid'
        : 'sync_error',
  );
}

function displayName(u: User) {
  return (u.displayName ?? u.email ?? 'Farmer').split(/[ @]/)[0].slice(0, 16);
}

export function inviteLink(code: string) {
  return `${location.origin}/?join=${code}`;
}

export function runLobby(): Promise<LobbyResult> {
  const params = new URLSearchParams(location.search);
  let joinCode = params.get('join');
  if (EMULATORS) $('#test-login').hidden = false;
  // Re-translate the lobby when the language toggle is used before the game starts.
  $('#lang').addEventListener('click', () => {
    for (const el of document.querySelectorAll<HTMLElement>('#lobby [data-t]')) el.textContent = t(el.dataset.t!);
  });

  return new Promise((resolve) => {
    let started = false;

    $('#google').onclick = async () => {
      $('#lobby-error').textContent = '';
      const provider = new GoogleAuthProvider();
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        // Some phone browsers block popups; fall back to a full redirect.
        if ((e as { code?: string }).code === 'auth/popup-blocked') await signInWithRedirect(auth, provider);
        else if ((e as { code?: string }).code !== 'auth/popup-closed-by-user') error(e);
      }
    };
    $('#test-login').onsubmit = async (ev) => {
      ev.preventDefault();
      const name = $<HTMLInputElement>('#test-name').value.trim() || 'test';
      const email = `${name.toLowerCase()}@vuon-chung.test`;
      try {
        await signInWithEmailAndPassword(auth, email, 'password123');
      } catch {
        await createUserWithEmailAndPassword(auth, email, 'password123');
      }
    };

    let entering = false;
    const enter = async (worldId: string, uid: string, isNew = false) => {
      if (entering) return; // double clicks
      entering = true;
      // Drop ?rooms=1 so the 🏡 button and reloads behave from inside the garden.
      history.replaceState(null, '', location.pathname + keepParams() + location.hash);
      let store: SharedStore;
      try {
        store = await SharedStore.open(worldId, uid);
      } catch (e) {
        entering = false;
        throw e;
      }
      void rememberRoom(uid, worldId);
      $('#lobby').hidden = true;
      resolve({ store, isNew });
    };

    const handleUser = async (user: User | null) => {
      if (!user) return show('signin');
      if (started) return;
      started = true;
      show('loading');
      try {
        await syncServerClock(user.uid);
        setupCreate(user, enter);
        if (joinCode) {
          // One attempt per link: drop the code so a retry doesn't loop on a bad invite.
          const code = joinCode;
          joinCode = null;
          history.replaceState(null, '', location.pathname + keepParams() + location.hash);
          try {
            return await enter(await joinWithInvite(code, user.uid, displayName(user)), user.uid);
          } catch (e) {
            await showRooms(user, enter);
            return error(e);
          }
        }
        const { rooms, lastRoom } = await myRooms(user.uid);
        // Straight back into the last garden unless the room list was asked for;
        // if that garden can't be opened, fall back to the list instead of looping.
        if (!params.has('rooms') && lastRoom && rooms.includes(lastRoom)) {
          try {
            return await enter(lastRoom, user.uid);
          } catch (e) {
            await showRooms(user, enter);
            return error(e);
          }
        }
        await showRooms(user, enter);
      } catch (e) {
        started = false;
        show('retry');
        $('#retry').onclick = () => void handleUser(auth.currentUser);
        error(e);
      }
    };
    onAuthStateChanged(auth, (user) => void handleUser(user));
  });
}

/** Query params worth keeping when cleaning the URL (emulator mode). */
function keepParams() {
  const p = new URLSearchParams(location.search);
  return p.get('emu') === '1' ? '?emu=1' : '';
}

type Enter = (worldId: string, uid: string, isNew?: boolean) => Promise<void>;

/** The room list: every garden you belong to, newest last. */
async function showRooms(user: User, enter: Enter) {
  show('loading');
  const { rooms } = await myRooms(user.uid);
  const summaries = (await Promise.all(rooms.map((id) => roomSummary(id, user.uid)))).filter(
    (r): r is RoomSummary => !!r,
  );
  const list = $('#room-list');
  list.replaceChildren(
    ...(summaries.length
      ? summaries.map((r) => {
          const li = document.createElement('li');
          const b = document.createElement('button');
          b.className = 'room';
          const title = document.createElement('b');
          title.textContent = r.name || t('room_default');
          const meta = document.createElement('small');
          meta.textContent = `${r.partner ? `♥ ${r.partner}` : t('room_alone')} · ${t('level', { n: r.level })}`;
          b.append(title, meta);
          if (r.test) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = t('test_badge');
            b.append(badge);
          }
          b.onclick = () => void enter(r.id, user.uid).catch(error);
          li.append(b);
          return li;
        })
      : [Object.assign(document.createElement('li'), { className: 'muted', textContent: t('rooms_empty') })]),
  );
  show('rooms');
  $('#new-room').onclick = () => show('create');
  $('#back-rooms').onclick = () => show('rooms');
}

function setupCreate(user: User, enter: Enter) {
  let look: Look = 'phu';
  for (const b of document.querySelectorAll<HTMLButtonElement>('#looks button')) {
    const cv = b.querySelector('canvas')!;
    void renderIcon(b.dataset.look as Look).then(
      (img) => img && cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height),
    );
    b.onclick = () => {
      look = b.dataset.look as Look;
      document.querySelectorAll('#looks button').forEach((x) => x.classList.toggle('on', x === b));
    };
  }
  $<HTMLInputElement>('#room-name').placeholder = t('room_name_ph');
  $('#create').onclick = async () => {
    try {
      $('#create').setAttribute('disabled', '');
      const name = $<HTMLInputElement>('#room-name').value;
      const test = $<HTMLInputElement>('#room-test').checked;
      const worldId = await createWorld(user.uid, { name: displayName(user), look }, name, test);
      const code = await createInvite(worldId, user.uid, look === 'phu' ? 'su' : 'phu');
      showInvite(code, () => void enter(worldId, user.uid, true));
    } catch (e) {
      $('#create').removeAttribute('disabled');
      error(e);
    }
  };
  $('#join').onsubmit = async (ev) => {
    ev.preventDefault();
    const raw = $<HTMLInputElement>('#join-code').value.trim();
    const code = /join=([a-z2-9]+)/.exec(raw)?.[1] ?? raw;
    try {
      await enter(await joinWithInvite(code, user.uid, displayName(user)), user.uid);
    } catch (e) {
      error(e);
    }
  };
}

/** Shows the invite link with a copy button; `onDone` enters the garden. */
export function showInvite(code: string, onDone: () => void) {
  show('invite');
  const link = inviteLink(code);
  $<HTMLInputElement>('#invite-link').value = link;
  $('#copy').onclick = async () => {
    try {
      await navigator.clipboard.writeText(link);
      $('#copy').textContent = t('copied');
    } catch {
      $<HTMLInputElement>('#invite-link').select();
    }
  };
  $('#enter').onclick = onDone;
}

/** In-game "invite partner" button for a world that still has one member. */
export async function inviteFromGame(store: SharedStore) {
  const myLook = store.profiles[store.uid]?.look ?? 'phu';
  const code = await createInvite(store.worldId, store.uid, myLook === 'phu' ? 'su' : 'phu');
  showInvite(code, () => ($('#lobby').hidden = true));
}

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
import { drawAvatar } from '../game/textures';
import { t } from '../i18n';
import { EMULATORS, auth } from '../net/firebase';
import {
  SharedStore,
  createInvite,
  createWorld,
  findMyWorld,
  joinWithInvite,
  syncServerClock,
  worldMemberCount,
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
    code.includes('invite') || code.includes('permission') ? 'invite_invalid' : 'sync_error',
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

    const handleUser = async (user: User | null) => {
      if (!user) return show('signin');
      if (started) return;
      started = true;
      show('loading');
      try {
        await syncServerClock(user.uid);
        let worldId = await findMyWorld(user.uid);
        // A partner's invite wins over a garden you only started alone; a garden
        // you already share is never left behind by opening some link.
        const ownIsSolo = worldId ? (await worldMemberCount(worldId)) < 2 : true;
        if (joinCode && ownIsSolo) {
          // One attempt per link: drop the code so a retry doesn't loop on a bad invite.
          const code = joinCode;
          joinCode = null;
          history.replaceState(null, '', location.pathname + location.hash);
          try {
            worldId = await joinWithInvite(code, user.uid, displayName(user));
          } catch (e) {
            if (!worldId) throw e; // no garden to fall back to
            console.warn('invite rejected; opening your own garden', e);
          }
        }
        if (worldId) {
          const store = await SharedStore.open(worldId, user.uid);
          $('#lobby').hidden = true;
          return resolve({ store, isNew: false });
        }
        show('create');
        setupCreate(user, resolve);
      } catch (e) {
        // Never fall through to "create": that could orphan an existing garden.
        started = false;
        show('retry');
        $('#retry').onclick = () => void handleUser(auth.currentUser);
        error(e);
      }
    };
    onAuthStateChanged(auth, (user) => void handleUser(user));
  });
}

function setupCreate(user: User, resolve: (r: LobbyResult) => void) {
  let look: Look = 'phu';
  for (const b of document.querySelectorAll<HTMLButtonElement>('#looks button')) {
    drawAvatar(b.querySelector('canvas')!, b.dataset.look as Look);
    b.onclick = () => {
      look = b.dataset.look as Look;
      document.querySelectorAll('#looks button').forEach((x) => x.classList.toggle('on', x === b));
    };
  }
  $('#create').onclick = async () => {
    try {
      $('#create').setAttribute('disabled', '');
      const worldId = await createWorld(user.uid, { name: displayName(user), look });
      const code = await createInvite(worldId, user.uid, look === 'phu' ? 'su' : 'phu');
      const store = await SharedStore.open(worldId, user.uid);
      showInvite(code, () => {
        $('#lobby').hidden = true;
        resolve({ store, isNew: true });
      });
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
      const worldId = await joinWithInvite(code, user.uid, displayName(user));
      const store = await SharedStore.open(worldId, user.uid);
      $('#lobby').hidden = true;
      resolve({ store, isNew: false });
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

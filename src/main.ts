import { DEV } from './clock';
import { GameController, type GameBoot } from './game/controller';
import { iconFor, prepareIcons } from './game/icons';
import { Farm3DView } from './game/view3d';
import { t } from './i18n';
import { Presence } from './net/presence';
import { LocalStore } from './net/world-store';
import { Hud, setIconSource } from './ui/hud';
import { inviteFromGame, runLobby } from './ui/lobby';
import { registerSW } from 'virtual:pwa-register';

// Installable app: the worker caches the shell and models. A new version waits until
// the player taps "Update" so a refresh never interrupts play.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const update = registerSW({
    onNeedRefresh() {
      const b = document.querySelector<HTMLButtonElement>('#update')!;
      b.textContent = t('update_ready');
      b.hidden = false;
      b.onclick = () => void update(true);
    },
  });
}

// Solo mode: the fast dev clock or ?local=1 play offline against localStorage.
const LOCAL = DEV || new URLSearchParams(location.search).has('local');

function start(boot: Omit<GameBoot, 'view'>) {
  setIconSource(iconFor);
  void prepareIcons().then(() => boot.hud.render(boot.store.farm, 'rau_muong'));
  const game = new GameController({ ...boot, view: new Farm3DView() });
  game.start(document.querySelector('#game')!).catch((e) => {
    console.error(e);
    showFatal(t('fatal_load'));
  });
}

/** A clear message with a reload button when the 3D garden can't start. */
function showFatal(msg: string) {
  document.querySelector('#loading')?.setAttribute('hidden', '');
  const card = document.querySelector<HTMLElement>('#fatal')!;
  card.querySelector('p')!.textContent = msg;
  card.querySelector('button')!.textContent = t('retry');
  card.querySelector('button')!.onclick = () => location.reload();
  card.hidden = false;
}

function webglAvailable() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const hud = new Hud();
if (!webglAvailable()) showFatal(t('fatal_webgl'));

if (LOCAL) {
  const store = new LocalStore();
  start({ store, isNew: store.isNew, hud });
} else {
  void runLobby().then(({ store, isNew }) => {
    const invite = document.querySelector<HTMLButtonElement>('#invite')!;
    const syncInvite = () => {
      invite.hidden = store.members.length > 1;
      invite.textContent = t('invite_btn');
    };
    invite.onclick = () => void inviteFromGame(store).catch(() => hud.toast(t('sync_error')));
    store.onChange(syncInvite);
    const rooms = document.querySelector<HTMLButtonElement>('#rooms-btn')!;
    rooms.hidden = false;
    rooms.title = t('switch_room');
    rooms.onclick = () => {
      const emu = new URLSearchParams(location.search).get('emu') === '1' ? '&emu=1' : '';
      location.href = `/?rooms=1${emu}${location.hash}`;
    };
    document.querySelector('#lang')!.addEventListener('click', syncInvite);
    syncInvite();
    start({
      store,
      isNew,
      hud,
      connectPresence: (onPartner) => new Presence(store.worldId, store.uid, onPartner),
    });
  });
}

import Phaser from 'phaser';
import { DEV } from './clock';
import { FarmScene, type SceneBoot } from './game/farm-scene';
import { t } from './i18n';
import { Presence } from './net/presence';
import { LocalStore } from './net/world-store';
import { Hud } from './ui/hud';
import { inviteFromGame, runLobby } from './ui/lobby';

// Solo mode: the fast dev clock or ?local=1 play offline against localStorage.
const LOCAL = DEV || new URLSearchParams(location.search).has('local');

function start(boot: SceneBoot) {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#5f9f42',
    pixelArt: true,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: [new FarmScene(boot)],
  });
}

const hud = new Hud();

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

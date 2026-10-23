import Phaser from 'phaser';
import { FarmScene } from './game/farm-scene';
import { loadFarm } from './save';

const boot = loadFarm();

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#5f9f42',
  pixelArt: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: [new FarmScene(boot)],
});

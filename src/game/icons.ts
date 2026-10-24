// Icons for the DOM HUD, rendered from the same 3D models as the world so the
// hotbar, shop and bag match what you see in the garden.
import * as THREE from 'three';
import { instance } from './models';

/** Item id (crop, product, dish, animal, avatar) → model and a yaw for a nice angle. */
const ICON_MODEL: Record<string, string> = {
  rau_muong: 'food/cabbage',
  strawberry: 'food/strawberry',
  sunflower: 'nature/flower_yellowA',
  rose: 'nature/flower_redA',
  pumpkin: 'food/pumpkin',
  rice: 'food/rice-ball',
  egg: 'food/egg',
  duck_egg: 'food/egg',
  milk: 'survival/bucket',
  rau_xao: 'food/bowl-soup',
  mut_dau: 'food/pudding',
  com_trung: 'food/rice-ball',
  bo_hoa: 'nature/flower_purpleA',
  banh_flan: 'food/pudding',
  che_bi_do: 'food/bowl-soup',
  chicken_0: 'pets/animal-chick',
  duck_0: 'pets/animal-chick',
  cow_0: 'pets/animal-cow',
  phu: 'chars/character-male-a',
  su: 'chars/character-female-a',
};

const SIZE = 96;
let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, HTMLCanvasElement>();

function getRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }
  return renderer;
}

/** Renders one model to a transparent square canvas, framed to fit. */
export async function renderIcon(id: string): Promise<HTMLCanvasElement | null> {
  const cached = cache.get(id);
  if (cached) return cached;
  const path = ICON_MODEL[id];
  if (!path) return null;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a60, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(2, 3, 2);
  scene.add(sun);
  const model = await instance(path, 1, false);
  model.rotation.y = -0.6;
  scene.add(model);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) * 0.62;
  const cam = new THREE.OrthographicCamera(-r, r, r, -r, 0.01, 50);
  cam.position.set(center.x + 2, center.y + 1.4, center.z + 2.6);
  cam.lookAt(center);
  const gl = getRenderer();
  gl.setClearColor(0x000000, 0);
  gl.render(scene, cam);
  const out = document.createElement('canvas');
  out.width = out.height = SIZE;
  out.getContext('2d')!.drawImage(gl.domElement, 0, 0);
  cache.set(id, out);
  return out;
}

/** Renders every HUD icon up front so drawing them later is synchronous. */
export async function prepareIcons() {
  for (const id of Object.keys(ICON_MODEL)) await renderIcon(id);
}

export function iconFor(id: string): HTMLCanvasElement | null {
  return cache.get(id) ?? null;
}

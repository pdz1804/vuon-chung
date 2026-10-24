// Model loading for the 3D view: CC0 Kenney kits under /models, loaded once,
// normalised to a target height in tiles, cloned (skeleton-aware) per use.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

export function load(path: string): Promise<GLTF> {
  let p = cache.get(path);
  if (!p) {
    p = loader.loadAsync(`/models/${path}.glb`);
    cache.set(path, p);
  }
  return p;
}

/** Loads many models in parallel; resolves when all are ready (for the loading screen). */
export async function preload(paths: string[], onProgress?: (done: number, total: number) => void) {
  let done = 0;
  await Promise.all(
    paths.map((p) =>
      load(p).then(() => {
        done++;
        onProgress?.(done, paths.length);
      }),
    ),
  );
}

/** Uniformly scales an object so its height is `height` tiles and its base sits at y=0. */
export function fitHeight(obj: THREE.Object3D, height: number) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const h = box.max.y - box.min.y || 1;
  const s = height / h;
  obj.scale.multiplyScalar(s);
  obj.updateMatrixWorld(true);
  const after = new THREE.Box3().setFromObject(obj);
  obj.position.y -= after.min.y;
  return obj;
}

/**
 * Kenney's nature kit is tinted teal; the garden wants warm, lush greens.
 * Keys are the kit's material names.
 */
const RECOLOR: Record<string, number> = {
  leafsGreen: 0x5fb04a,
  leafsDark: 0x3f8c3c,
  leafsLight: 0x86c95a,
  grass: 0x6cbf4e,
  grassDark: 0x4f9e3f,
  // Wheat (our rice) grain heads ship untextured white.
  _defaultMat: 0xe8c35a,
};

/** Kenney GLBs ship fully metallic materials, which render black without reflections. */
function matte(mat: THREE.Material | THREE.Material[]) {
  for (const m of Array.isArray(mat) ? mat : [mat]) {
    const s = m as THREE.MeshStandardMaterial;
    if ('metalness' in s) {
      s.metalness = 0;
      s.roughness = Math.max(0.6, s.roughness ?? 1);
    }
    const tint = RECOLOR[m.name];
    if (tint !== undefined && s.color) s.color.setHex(tint);
  }
}

function prepare(root: THREE.Object3D, shadows: boolean) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = shadows;
      m.receiveShadow = shadows;
      matte(m.material);
    }
  });
}

/** A fresh, independent copy of a model (skinned meshes keep their own skeleton). */
export async function instance(path: string, height: number, shadows = true): Promise<THREE.Group> {
  const gltf = await load(path);
  const holder = new THREE.Group();
  const copy = cloneSkinned(gltf.scene);
  prepare(copy, shadows);
  holder.add(copy);
  fitHeight(copy, height);
  holder.userData.animations = gltf.animations;
  return holder;
}

/**
 * Many copies of one static model as instanced meshes: one draw call per
 * material instead of one per copy. `at` gives each copy's tile position,
 * rotation (radians) and size multiplier.
 */
export async function instancedField(
  path: string,
  height: number,
  at: Array<{ x: number; z: number; rot?: number; scale?: number }>,
  shadows = true,
): Promise<THREE.Group> {
  const gltf = await load(path);
  const base = gltf.scene.clone(true);
  fitHeight(base, height);
  base.updateMatrixWorld(true);
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];
  base.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const mesh of meshes) {
    matte(mesh.material);
    const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, at.length);
    inst.castShadow = shadows;
    inst.receiveShadow = shadows;
    at.forEach((p, i) => {
      const s = p.scale ?? 1;
      m.compose(new THREE.Vector3(p.x, 0, p.z), q.setFromAxisAngle(up, p.rot ?? 0), new THREE.Vector3(s, s, s));
      inst.setMatrixAt(i, m.multiply(mesh.matrixWorld));
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }
  return group;
}

// The 3D farm: a small diorama drawn with three.js and CC0 Kenney models.
// It only draws; rules and actions live in the controller and the sim.
import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Pose } from '../net/presence';
import type { Look, Profile } from '../net/world-store';
import { animalPosition, fedToday } from '../sim/animals';
import { partnerTendedToday, treeStage, unreadFor } from '../sim/couple';
import { cropStage, cropWilted, plotState, type FarmState } from '../sim/farm';
import type { SpeciesId } from '../sim/species';
import { instance, instancedField, preload } from './models';
import { DIRS, PX_PER_TILE, type Facing, type FarmView } from './view';
import { FIELD, MAP_H, MAP_W, PEN, PROPS, SPAWN, buildGround, isBlocked, type Ground } from './world-map';

const SPEED = 4.4; // tiles per second
const RADIUS = 0.28; // farmer collision radius, tiles
const COARSE = matchMedia('(pointer: coarse)').matches;
/** Test switch: run the game loop but skip drawing (networking tests on GPU-less CI). */
const NO_RENDER = new URLSearchParams(location.search).has('norender');

const AVATAR: Record<Look, string> = { phu: 'chars/character-male-a', su: 'chars/character-female-a' };
const ANIMAL_MODEL = { chicken: 'pets/animal-chick', duck: 'pets/animal-chick', cow: 'pets/animal-cow' } as const;
/** Ducks reuse the chick model with a cool tint until a real duck model exists. */
const ANIMAL_TINT: Partial<Record<keyof typeof ANIMAL_MODEL, number>> = { duck: 0x8fe3d2 };
const ANIMAL_HEIGHT = { chicken: 0.42, duck: 0.42, cow: 0.85 } as const;

const ALL_MODELS = [
  ...Object.values(AVATAR),
  ...Object.values(ANIMAL_MODEL),
  'nature/tree_default',
  'nature/tree_oak',
  'nature/tree_fat',
  'nature/tree_pineRoundA',
  'nature/tree_small',
  'nature/tree_detailed',
  'nature/plant_bush',
  'nature/plant_bushLarge',
  'nature/flower_redA',
  'nature/flower_yellowA',
  'nature/flower_purpleA',
  'nature/grass',
  'nature/grass_large',
  'nature/rock_smallA',
  'nature/mushroom_red',
  'nature/stump_round',
  'nature/lily_large',
  'nature/fence_simple',
  'nature/sign',
  'nature/crops_leafsStageA',
  'nature/crops_leafsStageB',
  'nature/crops_wheatStageA',
  'nature/crops_wheatStageB',
  'nature/crops_cornStageB',
  'nature/crop_pumpkin',
  'food/strawberry',
  'town/stall-red',
  'town/lantern',
  'survival/chest',
];

/** Crop model per species and growth stage: [model, height in tiles]. */
const CROP_LOOK: Record<SpeciesId, Array<[string, number]>> = {
  rau_muong: [
    ['', 0],
    ['nature/crops_leafsStageA', 0.22],
    ['nature/crops_leafsStageA', 0.34],
    ['nature/crops_leafsStageB', 0.42],
    ['nature/crops_leafsStageB', 0.55],
  ],
  strawberry: [
    ['', 0],
    ['nature/crops_leafsStageA', 0.2],
    ['nature/crops_leafsStageA', 0.3],
    ['nature/crops_leafsStageB', 0.38],
    ['nature/crops_leafsStageB', 0.42],
  ],
  sunflower: [
    ['', 0],
    ['nature/crops_leafsStageA', 0.25],
    ['nature/crops_cornStageB', 0.5],
    ['nature/crops_cornStageB', 0.75],
    ['nature/crops_cornStageB', 0.85],
  ],
  rose: [
    ['', 0],
    ['nature/crops_leafsStageA', 0.22],
    ['nature/plant_bush', 0.3],
    ['nature/plant_bush', 0.42],
    ['nature/plant_bush', 0.5],
  ],
  pumpkin: [
    ['', 0],
    ['nature/crops_leafsStageA', 0.22],
    ['nature/crops_leafsStageB', 0.32],
    ['nature/crops_leafsStageB', 0.4],
    ['nature/crop_pumpkin', 0.42],
  ],
  rice: [
    ['', 0],
    ['nature/crops_wheatStageA', 0.25],
    ['nature/crops_wheatStageA', 0.4],
    ['nature/crops_wheatStageB', 0.5],
    ['nature/crops_wheatStageB', 0.65],
  ],
};

const PALETTE = {
  grass: [0x5fae3f, 0x58a63a, 0x66b545],
  path: 0xd9b97a,
  field: 0x579e3a,
  soil: 0x8a5a36,
  soilWet: 0x5a3a22,
  slab: 0x8b6a45,
  water: 0x4fb1e0,
  daySky: new THREE.Color(0xbfe6ff),
  nightSky: new THREE.Color(0x1b2246),
};

/** Deterministic 0..1 noise per tile so decor is identical on every device. */
function hash(x: number, y: number, salt = 0) {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Actor {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string;
}

interface PartnerActor extends Actor {
  target: { x: number; y: number; f: Pose['f']; m: boolean };
  label: CSS2DObject;
  look: Look;
}

function facingAngle(f: Facing) {
  return { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 }[f];
}

export class Farm3DView implements FarmView {
  private renderer!: THREE.WebGLRenderer;
  private labels!: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  private camTarget = new THREE.Vector3();
  private hemi = new THREE.HemisphereLight(0xfff6e8, 0x5a7a3a, 0.85);
  private sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  private houseLight = new THREE.PointLight(0xffb15c, 0, 6, 1.6);
  private windowMat = new THREE.MeshStandardMaterial({ color: 0x9fd4ff, emissive: 0xffb54d, emissiveIntensity: 0 });
  private frameCbs: Array<(dt: number) => void> = [];
  private last = performance.now();

  private me!: Actor;
  private look: Look = 'phu';
  readonly player = { x: SPAWN.x + 0.5, y: SPAWN.y + 0.5, facing: 'down' as Facing, moving: false };
  private partners = new Map<string, PartnerActor>();
  private cursor!: THREE.Mesh;
  private plots = new Map<
    string,
    { soil: THREE.Mesh; plant?: THREE.Object3D; key: string; gen: number; sparkle?: THREE.Sprite }
  >();
  /** Ready crops bob gently so they stand out from growing ones. */
  private ready = new Set<THREE.Object3D>();
  private partnerGen = new Map<string, number>();
  private animals = new Map<string, Actor & { species: keyof typeof ANIMAL_MODEL }>();
  private animalPos = new Map<string, { x: number; y: number }>();
  private tree?: THREE.Object3D;
  private treeStageShown = -1;
  private grain!: THREE.Mesh;
  private mailHeart!: CSS2DObject;
  private rain!: THREE.Points;
  private raining = false;
  private water!: THREE.Mesh;
  private confetti?: { pts: THREE.Points; vel: Float32Array; t: number };
  private sparkleTex = makeSparkleTexture();

  async mount(parent: HTMLElement, look: Look) {
    this.look = look;
    // Partners spawn side by side at the gate.
    if (look === 'su') this.player.x += 1;

    this.renderer = new THREE.WebGLRenderer({ antialias: !COARSE, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, COARSE ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = !COARSE;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    parent.append(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels';
    parent.append(this.labels.domElement);

    document.querySelector('#loading')?.removeAttribute('hidden');
    const bar = document.querySelector<HTMLElement>('#loading-bar');
    // A missing model must not hang the loading screen: give up after 25 s.
    await Promise.race([
      preload(ALL_MODELS, (d, n) => bar?.style.setProperty('--p', `${Math.round((d / n) * 100)}%`)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('models timed out')), 25_000)),
    ]);
    document.querySelector('#loading')?.setAttribute('hidden', '');

    // A soft studio environment gives every material gentle reflections and fill.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    this.buildLights();
    await this.buildWorld();
    this.me = await this.makeActor(AVATAR[look], 0.95);
    this.scene.add(this.me.root);
    this.buildRain();

    const resize = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      this.renderer.setSize(w, h);
      this.labels.setSize(w, h);
      this.camera.aspect = w / h;
      // Portrait phones see a little more of the farm.
      this.camera.fov = w < h ? 46 : 30;
      this.camera.updateProjectionMatrix();
    };
    addEventListener('resize', resize);
    resize();
    this.camTarget.set(this.player.x, 0, this.player.y);
    this.renderer.setAnimationLoop(() => this.loop());
  }

  onFrame(cb: (dt: number) => void) {
    this.frameCbs.push(cb);
  }

  // ---------- world ----------

  private buildLights() {
    this.scene.background = PALETTE.daySky.clone();
    this.scene.fog = new THREE.Fog(PALETTE.daySky.clone(), 28, 60);
    this.scene.add(this.hemi);
    this.sun.position.set(-8, 14, 6);
    this.sun.castShadow = !COARSE;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -14;
    c.right = c.top = 14;
    c.near = 1;
    c.far = 40;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);
    this.houseLight.position.set(5, 1.6, 5.8);
    this.scene.add(this.houseLight);
  }

  private async buildWorld() {
    const ground = buildGround();
    // The diorama slab: earth sides under the whole map.
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(MAP_W, 1.2, MAP_H),
      new THREE.MeshStandardMaterial({ color: PALETTE.slab, roughness: 1 }),
    );
    slab.position.set(MAP_W / 2, -0.8, MAP_H / 2);
    slab.receiveShadow = true;
    this.scene.add(slab);

    // One instanced top tile per ground type, with a little colour variation.
    const tiles: Record<'grass' | 'path' | 'field', Array<[number, number]>> = { grass: [], path: [], field: [] };
    const pond: Array<[number, number]> = [];
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const g: Ground = ground[y][x];
        if (g === 'water') pond.push([x, y]);
        else if (g === 'path') tiles.path.push([x, y]);
        else if (g === 'field') tiles.field.push([x, y]);
        else tiles.grass.push([x, y]);
      }
    }
    const tileGeo = new THREE.BoxGeometry(1, 0.2, 1);
    const m4 = new THREE.Matrix4();
    for (const [kind, list] of Object.entries(tiles)) {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
      const mesh = new THREE.InstancedMesh(tileGeo, mat, list.length);
      const color = new THREE.Color();
      list.forEach(([x, y], i) => {
        const lift = kind === 'path' ? -0.12 : -0.1;
        mesh.setMatrixAt(i, m4.makeTranslation(x + 0.5, lift, y + 0.5));
        if (kind === 'grass') color.setHex(PALETTE.grass[Math.floor(hash(x, y) * 3)]);
        else color.setHex(kind === 'path' ? PALETTE.path : PALETTE.field);
        color.offsetHSL(0, 0, (hash(x, y, 7) - 0.5) * 0.03);
        mesh.setColorAt(i, color);
      });
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    // Pond: a gently rippling surface, lower than the grass.
    const xs = pond.map((p) => p[0]);
    const ys = pond.map((p) => p[1]);
    const pw = Math.max(...xs) - Math.min(...xs) + 1;
    const ph = Math.max(...ys) - Math.min(...ys) + 1;
    const waterGeo = new THREE.PlaneGeometry(pw, ph, pw * 4, ph * 4);
    waterGeo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(
      waterGeo,
      new THREE.MeshStandardMaterial({
        color: PALETTE.water,
        roughness: 0.15,
        metalness: 0.1,
        transparent: true,
        opacity: 0.88,
      }),
    );
    this.water.position.set(Math.min(...xs) + pw / 2, -0.16, Math.min(...ys) + ph / 2);
    this.scene.add(this.water);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.1, ph), new THREE.MeshStandardMaterial({ color: 0x2f6f8f }));
    bed.position.set(this.water.position.x, -0.32, this.water.position.z);
    this.scene.add(bed);
    this.scene.add(
      await instancedField(
        'nature/lily_large',
        0.06,
        [0, 1, 2, 3]
          .map((i) => ({
            x: Math.min(...xs) + 1 + i * 1.1,
            z: Math.min(...ys) + 1.2 + (i % 2) * 2,
            rot: i,
            scale: 1.4,
          }))
          .map((p) => ({ ...p, z: p.z })),
        false,
      ).then((g) => {
        g.position.y = -0.14;
        return g;
      }),
    );

    // Forest border: a mix of trees on the edge tiles.
    const forest: Record<string, Array<{ x: number; z: number; rot: number; scale: number }>> = {
      'nature/tree_default': [],
      'nature/tree_oak': [],
      'nature/tree_pineRoundA': [],
      'nature/tree_fat': [],
    };
    const kinds = Object.keys(forest);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (ground[y][x] !== 'tree') continue;
        const k = kinds[Math.floor(hash(x, y, 3) * kinds.length)];
        forest[k].push({
          x: x + 0.5 + (hash(x, y, 4) - 0.5) * 0.3,
          z: y + 0.5,
          rot: hash(x, y, 5) * 6,
          scale: 0.85 + hash(x, y, 6) * 0.4,
        });
      }
    }
    for (const [k, at] of Object.entries(forest)) this.scene.add(await instancedField(k, 2.4, at));

    // Field fence: rails along the field border, a gap at the gate.
    const fences: Array<{ x: number; z: number; rot: number }> = [];
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (ground[y][x] !== 'fence') continue;
        const horizontal = y === FIELD.y0 - 1 || y === FIELD.y1 + 1;
        fences.push({ x: x + 0.5, z: y + 0.5, rot: horizontal ? 0 : Math.PI / 2 });
      }
    }
    this.scene.add(await instancedField('nature/fence_simple', 0.45, fences));

    // Decor: flowers, grass tufts, rocks and mushrooms on open grass.
    const decor: Record<string, Array<{ x: number; z: number; rot: number; scale: number }>> = {
      'nature/grass': [],
      'nature/grass_large': [],
      'nature/flower_redA': [],
      'nature/flower_yellowA': [],
      'nature/flower_purpleA': [],
      'nature/rock_smallA': [],
      'nature/mushroom_red': [],
      'nature/plant_bush': [],
    };
    const decorKinds = Object.keys(decor);
    const pen = {
      x0: PEN.x0 / PX_PER_TILE,
      x1: PEN.x1 / PX_PER_TILE,
      y0: PEN.y0 / PX_PER_TILE,
      y1: PEN.y1 / PX_PER_TILE,
    };
    for (let y = 1; y < MAP_H - 1; y++) {
      for (let x = 1; x < MAP_W - 1; x++) {
        if (ground[y][x] !== 'grass' || isBlocked(x, y) || hash(x, y, 9) > 0.22) continue;
        if (x >= pen.x0 - 1 && x <= pen.x1 && y >= pen.y0 - 1 && y <= pen.y1) continue;
        const k = decorKinds[Math.floor(hash(x, y, 10) * decorKinds.length)];
        decor[k].push({
          x: x + 0.2 + hash(x, y, 11) * 0.6,
          z: y + 0.2 + hash(x, y, 12) * 0.6,
          rot: hash(x, y, 13) * 6,
          scale: 1,
        });
      }
    }
    const decorHeight: Record<string, number> = {
      'nature/grass': 0.18,
      'nature/grass_large': 0.28,
      'nature/flower_redA': 0.26,
      'nature/flower_yellowA': 0.26,
      'nature/flower_purpleA': 0.26,
      'nature/rock_smallA': 0.14,
      'nature/mushroom_red': 0.2,
      'nature/plant_bush': 0.38,
    };
    for (const [k, at] of Object.entries(decor))
      if (at.length) this.scene.add(await instancedField(k, decorHeight[k], at, false));

    await this.buildProps();

    // Target cursor: a soft ring on the tile you face.
    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.36, 0.46, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.cursor.rotation.x = -Math.PI / 2;
    this.cursor.position.y = 0.02;
    this.scene.add(this.cursor);
  }

  private async buildProps() {
    for (const p of PROPS) {
      const cx = p.x + p.w / 2;
      const cz = p.y + p.h / 2;
      if (p.id === 'house') this.scene.add(house(cx, cz, p.w, p.h, this.windowMat));
      else if (p.id === 'coop') this.scene.add(coop(cx, cz));
      else if (p.id === 'mailbox') {
        const mb = mailbox();
        mb.position.set(cx, 0, cz);
        this.scene.add(mb);
        const el = document.createElement('div');
        el.className = 'heart-bubble';
        el.textContent = '💌';
        this.mailHeart = new CSS2DObject(el);
        this.mailHeart.position.set(cx, 1.25, cz);
        this.mailHeart.visible = false;
        this.scene.add(this.mailHeart);
      } else if (p.id === 'feeder') {
        const f = feeder();
        f.position.set(cx, 0, cz);
        this.grain = f.getObjectByName('grain') as THREE.Mesh;
        this.scene.add(f);
      } else if (p.id === 'bin') {
        const chest = await instance('survival/chest', 0.6);
        chest.position.set(cx, 0, cz);
        chest.rotation.y = Math.PI;
        this.scene.add(chest);
      } else if (p.id === 'stall') {
        const stall = await instance('town/stall-red', 1.9);
        stall.position.set(cx, 0, cz);
        this.scene.add(stall);
      } else if (p.id === 'board') {
        const sign = await instance('nature/sign', 1.2);
        sign.position.set(cx, 0, cz);
        this.scene.add(sign);
      } else if (p.id === 'sapling') {
        this.tree = new THREE.Group();
        this.tree.position.set(cx, 0, cz);
        this.scene.add(this.tree);
      }
    }
    // Lanterns by the house and along the path glow at night.
    for (const [x, z] of [
      [7.6, 5.6],
      [13.6, 6.5],
      [18.4, 6.5],
    ]) {
      const l = await instance('town/lantern', 1.3);
      l.position.set(x, 0, z);
      this.scene.add(l);
    }
  }

  // ---------- actors ----------

  private async makeActor(path: string, height: number): Promise<Actor> {
    const root = await instance(path, height, !COARSE);
    root.add(blobShadow(height > 0.6 ? 0.32 : 0.22));
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of root.userData.animations as THREE.AnimationClip[])
      actions.set(clip.name, mixer.clipAction(clip));
    const actor = { root, mixer, actions, current: '' };
    this.play(actor, 'idle');
    return actor;
  }

  private play(a: Actor, name: string, once = false) {
    const next = a.actions.get(name) ?? a.actions.get('idle');
    if (!next || a.current === name) return;
    const prev = a.actions.get(a.current);
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.fadeIn(0.15).play();
    prev?.fadeOut(0.15);
    a.current = name;
  }

  // ---------- per frame ----------

  move(vx: number, vy: number, dtMs: number, speedMul: number) {
    const dt = Math.min(dtMs, 50) / 1000;
    const len = Math.hypot(vx, vy);
    const moving = len > 0.3;
    if (moving) {
      const step = (SPEED * speedMul * dt) / Math.max(1, len);
      this.tryMove(vx * step, 0);
      this.tryMove(0, vy * step);
      this.player.facing = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up';
    }
    this.player.moving = moving;
    if (this.me.current !== 'pick-up' || !this.me.actions.get('pick-up')?.isRunning()) {
      this.play(this.me, moving ? (speedMul > 1 ? 'sprint' : 'walk') : 'idle');
    }
  }

  /** Moves along one axis unless the farmer's circle would enter a blocked tile. */
  private tryMove(dx: number, dy: number) {
    const nx = this.player.x + dx;
    const ny = this.player.y + dy;
    for (const [ox, oy] of [
      [-RADIUS, -RADIUS],
      [RADIUS, -RADIUS],
      [-RADIUS, RADIUS],
      [RADIUS, RADIUS],
    ]) {
      if (isBlocked(Math.floor(nx + ox), Math.floor(ny + oy))) return;
    }
    this.player.x = nx;
    this.player.y = ny;
  }

  target(): [number, number] {
    const [dx, dy] = DIRS[this.player.facing];
    return [Math.floor(this.player.x) + dx, Math.floor(this.player.y) + dy];
  }

  animalAt(tx: number, ty: number): string | null {
    let best: string | null = null;
    let bestD = 0.95;
    for (const [id, p] of this.animalPos) {
      const d = Math.hypot(p.x - (tx + 0.5), p.y - (ty + 0.5));
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  private loop() {
    const t = performance.now();
    const dt = t - this.last;
    this.last = t;
    for (const cb of this.frameCbs) cb(dt);
    const s = dt / 1000;

    // Farmer: position, smooth turn, animation.
    const root = this.me.root;
    root.position.set(this.player.x, 0, this.player.y);
    root.rotation.y = turnToward(root.rotation.y, facingAngle(this.player.facing), s * 12);
    this.me.mixer.update(s);

    // Partners ease toward their last reported position.
    for (const p of this.partners.values()) {
      const r = p.root;
      const far = Math.hypot(p.target.x - r.position.x, p.target.y - r.position.z) > 3;
      const a = far ? 1 : Math.min(1, s * 10);
      r.position.x += (p.target.x - r.position.x) * a;
      r.position.z += (p.target.y - r.position.z) * a;
      const f = ({ d: 'down', u: 'up', l: 'left', r: 'right' } as const)[p.target.f];
      r.rotation.y = turnToward(r.rotation.y, facingAngle(f), s * 12);
      if (p.current !== 'pick-up') this.play(p, p.target.m ? 'walk' : 'idle');
      p.mixer.update(s);
    }

    // Animals wander on a clock-derived path, identical on both phones.
    let i = 0;
    for (const [id, a] of this.animals) {
      const pos = animalPosition(id, i++, Date.now(), PEN);
      const x = pos.x / PX_PER_TILE;
      const y = pos.y / PX_PER_TILE;
      const prev = this.animalPos.get(id);
      this.animalPos.set(id, { x, y });
      a.root.position.set(x, 0, y);
      if (prev && pos.moving) {
        const ang = Math.atan2(x - prev.x, y - prev.y);
        if (Math.hypot(x - prev.x, y - prev.y) > 1e-4) a.root.rotation.y = turnToward(a.root.rotation.y, ang, s * 8);
      }
      this.play(a, pos.moving ? 'walk' : 'idle');
      a.mixer.update(s);
    }

    // Cursor on the faced tile, gently pulsing.
    const [tx, ty] = this.target();
    this.cursor.position.set(tx + 0.5, 0.03, ty + 0.5);
    (this.cursor.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(t / 250) * 0.2;

    // Camera follows smoothly, framed so the farmer sits a bit below centre.
    this.camTarget.lerp(new THREE.Vector3(this.player.x, 0, this.player.y), 1 - Math.pow(0.001, s));
    const dist = this.camera.aspect < 1 ? 25 : 17;
    this.camera.position.set(this.camTarget.x, this.camTarget.z * 0 + dist * 0.8, this.camTarget.z + dist * 0.75);
    this.camera.lookAt(this.camTarget.x, 0.3, this.camTarget.z);
    // The sun's shadow box follows the farmer.
    this.sun.position.set(this.camTarget.x - 8, 14, this.camTarget.z + 6);
    this.sun.target.position.copy(this.camTarget);

    this.animateWater(t);
    this.animateRain(s);
    this.animateConfetti(s);
    for (const m of this.ready) m.scale.setScalar(1 + Math.sin(t / 260 + m.position.x) * 0.04);
    for (const plot of this.plots.values()) {
      if (plot.sparkle) plot.sparkle.position.y = 0.75 + Math.sin(t / 300 + plot.soil.position.x) * 0.06;
    }
    // Labels are DOM (name tags, emotes) and stay on even when WebGL drawing is off.
    if (!NO_RENDER) this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  private animateWater(t: number) {
    const pos = this.water.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, Math.sin(x * 2.2 + t / 600) * 0.025 + Math.cos(z * 2.6 + t / 750) * 0.02);
    }
    pos.needsUpdate = true;
  }

  // ---------- farm state ----------

  drawFarm(farm: FarmState, now: number, uid: string) {
    const seen = new Set<string>();
    for (const [k, plot] of Object.entries(farm.plots)) {
      seen.add(k);
      const [x, y] = k.split(',').map(Number);
      let p = this.plots.get(k);
      if (!p) {
        const soil = new THREE.Mesh(
          soilGeometry,
          new THREE.MeshStandardMaterial({ color: PALETTE.soil, roughness: 1 }),
        );
        soil.position.set(x + 0.5, 0, y + 0.5);
        soil.receiveShadow = true;
        this.scene.add(soil);
        p = { soil, key: '', gen: 0 };
        this.plots.set(k, p);
      }
      const wet = !!plot.crop && plotState(plot, now) !== 'needs_water';
      (p.soil.material as THREE.MeshStandardMaterial).color.setHex(wet ? PALETTE.soilWet : PALETTE.soil);

      const stage = plot.crop ? cropStage(plot.crop, now) : -1;
      const wilted = !!plot.crop && cropWilted(plot.crop, now);
      const key = plot.crop ? `${plot.crop.species}:${stage}:${wilted}` : '';
      if (key !== p.key) {
        p.key = key;
        if (p.plant) this.removePlant(p.plant);
        p.plant = undefined;
        const gen = ++p.gen;
        if (plot.crop) {
          const target = p;
          void this.plantModel(plot.crop.species, stage, wilted).then((m) => {
            if (target.gen !== gen) return disposeOwned(m); // superseded while loading
            m.position.set(x + 0.5, 0.06, y + 0.5);
            m.rotation.y = hash(x, y) * Math.PI * 2;
            target.plant = m;
            if (stage === 4 && !wilted) this.ready.add(m);
            this.scene.add(m);
          });
        }
      }

      // A sparkle marks plants your partner cared for today: tend them for ✋✋.
      const glow = !!plot.crop && partnerTendedToday(plot.crop, uid, now);
      if (glow && !p.sparkle) {
        p.sparkle = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: this.sparkleTex, transparent: true, depthWrite: false }),
        );
        p.sparkle.scale.set(0.35, 0.35, 0.35);
        p.sparkle.position.set(x + 0.7, 0.75, y + 0.4);
        this.scene.add(p.sparkle);
      } else if (!glow && p.sparkle) {
        this.scene.remove(p.sparkle);
        p.sparkle = undefined;
      }
    }

    // Animals: add new ones, remove sold/missing ones.
    const ids = new Set(farm.animals.map((a) => a.id));
    for (const [id, a] of this.animals) {
      if (!ids.has(id)) {
        this.scene.remove(a.root);
        disposeOwned(a.root);
        this.animals.delete(id);
        this.animalPos.delete(id);
      }
    }
    for (const a of farm.animals) {
      if (this.animals.has(a.id)) continue;
      const placeholder = {
        root: new THREE.Group(),
        mixer: new THREE.AnimationMixer(new THREE.Group()),
        actions: new Map(),
        current: '',
        species: a.species,
      };
      this.animals.set(a.id, placeholder);
      void this.makeActor(ANIMAL_MODEL[a.species], ANIMAL_HEIGHT[a.species]).then((actor) => {
        if (this.animals.get(a.id) !== placeholder) return disposeOwned(actor.root);
        const tint = ANIMAL_TINT[a.species];
        if (tint !== undefined) tintAll(actor.root, tint);
        this.animals.set(a.id, { ...actor, species: a.species });
        this.scene.add(actor.root);
      });
    }

    this.grain.visible = fedToday(farm, now);
    this.mailHeart.visible = unreadFor(farm, uid) > 0;
    void this.showTree(treeStage(farm));
  }

  private removePlant(m: THREE.Object3D) {
    this.ready.delete(m);
    this.scene.remove(m);
    disposeOwned(m);
  }

  private async plantModel(species: SpeciesId, stage: number, wilted: boolean): Promise<THREE.Object3D> {
    const g = new THREE.Group();
    // Freshly sown: a few seeds on the mound.
    if (stage === 0) {
      for (const [dx, dz] of [
        [-0.1, 0.05],
        [0.08, -0.06],
        [0.04, 0.12],
      ]) {
        const seed = new THREE.Mesh(seedGeometry, seedMat);
        seed.position.set(dx, 0.02, dz);
        g.add(seed);
      }
      return g;
    }
    const [path, h] = CROP_LOOK[species][stage];
    const base = await instance(path, h, !COARSE);
    tintCrop(base, species);
    g.add(base);
    if (stage === 4 && species === 'strawberry') {
      for (const [dx, dz] of [
        [0.14, 0.05],
        [-0.12, 0.1],
        [0.02, -0.15],
      ]) {
        const berry = await instance('food/strawberry', 0.13, false);
        berry.position.set(dx, 0.08, dz);
        g.add(berry);
      }
    }
    if (species === 'sunflower' && stage >= 3) g.add(sunflowerHead(stage === 4 ? 0.2 : 0.12, h));
    if (stage === 4 && species === 'rose') {
      const bloom = await instance('nature/flower_redA', 0.32, false);
      bloom.position.y = 0.22;
      g.add(bloom);
    }
    if (wilted) {
      g.rotation.z = 0.25;
      g.scale.setScalar(0.85);
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          const mat = (m.material as THREE.MeshStandardMaterial).clone();
          mat.color.multiplyScalar(0.6).lerp(new THREE.Color(0xa08850), 0.4);
          mat.userData.owned = true; // freed with the plant
          m.material = mat;
        }
      });
    }
    return g;
  }

  private async showTree(stage: number) {
    if (!this.tree || stage === this.treeStageShown) return;
    this.treeStageShown = stage;
    const heights = [0.9, 1.4, 1.9, 2.4, 2.9];
    const model = await instance(stage >= 3 ? 'nature/tree_detailed' : 'nature/tree_small', heights[stage]);
    // Pink blossoms, one cluster per stage: the tree flowers as memories grow.
    for (let i = 0; i < stage * 4; i++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07 + stage * 0.01), blossomMat);
      const a = (i / (stage * 4)) * Math.PI * 2;
      b.position.set(
        Math.cos(a) * (0.25 + stage * 0.08),
        heights[stage] * (0.55 + hash(i, stage) * 0.35),
        Math.sin(a) * (0.25 + stage * 0.08),
      );
      model.add(b);
    }
    this.tree.clear();
    this.tree.add(model);
  }

  // ---------- environment ----------

  setEnvironment(night: number, raining: boolean) {
    const sky = PALETTE.daySky.clone().lerp(PALETTE.nightSky, night * 0.85);
    (this.scene.background as THREE.Color).copy(raining ? sky.clone().lerp(new THREE.Color(0x8a9bb0), 0.5) : sky);
    (this.scene.fog as THREE.Fog).color.copy(this.scene.background as THREE.Color);
    this.hemi.intensity = 0.85 - night * 0.55 - (raining ? 0.15 : 0);
    this.sun.intensity = (2.2 - night * 2) * (raining ? 0.45 : 1);
    this.sun.color.setHex(night > 0.5 ? 0x9fb4ff : 0xfff1d6);
    this.windowMat.emissiveIntensity = night * 1.6;
    this.scene.environmentIntensity = 0.3 * (1 - night * 0.8);
    this.houseLight.intensity = night * 6;
    this.raining = raining;
    this.rain.visible = raining;
  }

  private buildRain() {
    const n = COARSE ? 350 : 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * 24 - 12;
      pos[i * 3 + 1] = Math.random() * 8;
      pos[i * 3 + 2] = Math.random() * 20 - 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xd6ecff, size: 0.11, transparent: true, opacity: 0.75 }),
    );
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  private animateRain(s: number) {
    if (!this.raining) return;
    this.rain.position.set(this.camTarget.x, 0, this.camTarget.z);
    const pos = this.rain.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) - s * 9;
      if (y < 0) y += 8;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  }

  celebrate() {
    const n = 160;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos.set([this.player.x, 1.2, this.player.y], i * 3);
      vel.set([(Math.random() - 0.5) * 4, 3 + Math.random() * 3, (Math.random() - 0.5) * 4], i * 3);
      c.setHSL(Math.random(), 0.8, 0.6);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.09, vertexColors: true }));
    if (this.confetti) this.scene.remove(this.confetti.pts);
    this.confetti = { pts, vel, t: 0 };
    this.scene.add(pts);
    this.play(this.me, 'emote-yes', true);
  }

  private animateConfetti(s: number) {
    const c = this.confetti;
    if (!c) return;
    c.t += s;
    const pos = c.pts.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      c.vel[i * 3 + 1] -= 9 * s;
      pos.setXYZ(
        i,
        pos.getX(i) + c.vel[i * 3] * s,
        Math.max(0.02, pos.getY(i) + c.vel[i * 3 + 1] * s),
        pos.getZ(i) + c.vel[i * 3 + 2] * s,
      );
    }
    pos.needsUpdate = true;
    if (c.t > 2.5) {
      this.scene.remove(c.pts);
      this.confetti = undefined;
    }
  }

  playAction() {
    this.play(this.me, 'pick-up', true);
    setTimeout(() => {
      if (this.me.current === 'pick-up') this.play(this.me, 'idle');
    }, 700);
  }

  // ---------- partners and bubbles ----------

  partner(uid: string, pose: Pose | null, profile: Profile | undefined) {
    const existing = this.partners.get(uid);
    if (!pose) {
      this.partnerGen.set(uid, (this.partnerGen.get(uid) ?? 0) + 1);
      if (existing) {
        this.scene.remove(existing.root);
        existing.label.element.remove();
        this.partners.delete(uid);
      }
      return;
    }
    if (existing) {
      existing.target = { x: pose.x, y: pose.y, f: pose.f, m: pose.m };
      existing.label.element.textContent = profile?.name ?? '';
      return;
    }
    const look: Look = profile?.look ?? (this.look === 'phu' ? 'su' : 'phu');
    const el = document.createElement('div');
    el.className = 'name-tag';
    el.textContent = profile?.name ?? '';
    const label = new CSS2DObject(el);
    label.position.y = 1.15;
    const placeholder = {
      root: new THREE.Group(),
      mixer: new THREE.AnimationMixer(new THREE.Group()),
      actions: new Map(),
      current: '',
      target: { x: pose.x, y: pose.y, f: pose.f, m: pose.m },
      label,
      look,
    };
    placeholder.root.position.set(pose.x, 0, pose.y);
    this.partners.set(uid, placeholder);
    const gen = this.partnerGen.get(uid) ?? 0;
    void this.makeActor(AVATAR[look], 0.95).then((actor) => {
      const current = this.partners.get(uid);
      // Left (and maybe rejoined) while loading: this actor is stale.
      if (!current || current !== placeholder || (this.partnerGen.get(uid) ?? 0) !== gen) return;
      actor.root.position.copy(current.root.position);
      actor.root.add(label);
      Object.assign(current, actor, { target: current.target });
      this.scene.add(actor.root);
    });
  }

  partnerPositions() {
    return [...this.partners.values()].map((p) => ({ x: p.root.position.x, y: p.root.position.z, moving: p.target.m }));
  }

  bubble(who: string, emoji: string) {
    const root = who === 'me' ? this.me.root : this.partners.get(who)?.root;
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'emote-bubble';
    el.textContent = emoji;
    const label = new CSS2DObject(el);
    label.position.y = 1.35;
    root.add(label);
    setTimeout(() => {
      root.remove(label);
      el.remove();
    }, 2600);
  }
}

// ---------- small procedural pieces ----------

const soilGeometry = (() => {
  const g = new THREE.CylinderGeometry(0.4, 0.44, 0.08, 12);
  g.translate(0, 0.02, 0);
  return g;
})();
const blossomMat = new THREE.MeshStandardMaterial({ color: 0xf7a8c4, roughness: 0.6 });

function turnToward(current: number, target: number, step: number) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + Math.max(-step, Math.min(step, d));
}

function blobShadow(r: number) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(r, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.015;
  return m;
}

function std(color: number, roughness = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

/** A gable roof (triangular prism) of width w (x), depth d (z), height h. */
function roof(w: number, d: number, h: number, mat: THREE.Material) {
  const shape = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

function house(cx: number, cz: number, w: number, d: number, windowMat: THREE.Material) {
  const g = new THREE.Group();
  g.position.set(cx, 0, cz);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 1.5, d - 0.4), std(0xf4e6c8));
  body.position.y = 0.75;
  body.castShadow = body.receiveShadow = true;
  const base = new THREE.Mesh(new THREE.BoxGeometry(w - 0.15, 0.2, d - 0.25), std(0x9b8a76));
  base.position.y = 0.1;
  const r = roof(d + 0.1, w + 0.2, 1.1, std(0xc8553d, 0.7));
  r.rotation.y = Math.PI / 2;
  r.position.y = 1.5;
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.25, 0.08, 0.14), std(0x9e3c2a));
  ridge.position.y = 2.6;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.85, 0.06), std(0x7a4a2a));
  door.position.set(0.15, 0.52, (d - 0.4) / 2 + 0.02);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.035), std(0xe2b04a, 0.3));
  knob.position.set(0.33, 0.52, (d - 0.4) / 2 + 0.07);
  g.add(body, base, r, ridge, door, knob);
  for (const x of [-1.15, 1.05]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.05), windowMat);
    win.position.set(x, 0.95, (d - 0.4) / 2 + 0.02);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.55, 0.03), std(0x8a5a36));
    frame.position.set(x, 0.95, (d - 0.4) / 2 + 0.005);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.16), std(0x7a4a2a));
    box.position.set(x, 0.66, (d - 0.4) / 2 + 0.1);
    const flowers = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.12), std(0xf27a9b, 0.6));
    flowers.position.set(x, 0.75, (d - 0.4) / 2 + 0.1);
    g.add(frame, win, box, flowers);
  }
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.3), std(0x9b8a76));
  chimney.position.set(1.1, 2.3, -0.3);
  chimney.castShadow = true;
  g.add(chimney);
  return g;
}

function coop(cx: number, cz: number) {
  const g = new THREE.Group();
  g.position.set(cx, 0, cz);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.3), std(0xb5513a));
  body.position.y = 0.55;
  body.castShadow = body.receiveShadow = true;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 1.2), std(0x7a5232));
  legs.position.y = 0.05;
  const r = roof(1.5, 1.8, 0.6, std(0x6b4a32, 0.7));
  r.rotation.y = Math.PI / 2;
  r.position.y = 1.0;
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.05), std(0xf4e6c8));
  door.position.set(0, 0.45, 0.66);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.6), std(0x9a6b43));
  ramp.position.set(0, 0.12, 0.9);
  ramp.rotation.x = 0.35;
  g.add(body, legs, r, door, ramp);
  return g;
}

function mailbox() {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.1), std(0x7a5232));
  post.position.y = 0.37;
  const box = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.3, 4, 12), std(0xd9473f, 0.5));
  box.rotation.x = Math.PI / 2;
  box.position.y = 0.85;
  box.castShadow = true;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.12), std(0xffd54a, 0.5));
  flag.position.set(0.17, 0.95, -0.05);
  g.add(post, box, flag);
  return g;
}

function feeder() {
  const g = new THREE.Group();
  const trough = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.22, 0.4), std(0x8a5a36));
  trough.position.y = 0.11;
  trough.castShadow = true;
  const grain = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.04, 0.3), std(0xe8c35a, 0.9));
  grain.position.y = 0.23;
  grain.name = 'grain';
  g.add(trough, grain);
  return g;
}

function makeSparkleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const grad = x.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(0.3, 'rgba(255,240,150,0.9)');
  grad.addColorStop(1, 'rgba(255,240,150,0)');
  x.fillStyle = grad;
  x.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const r = i % 2 ? 10 : 30;
    x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const seedGeometry = new THREE.SphereGeometry(0.035, 6, 4);
const seedMat = new THREE.MeshStandardMaterial({ color: 0xf1dfa6, roughness: 0.8 });

/** Per-crop colours the kit gets wrong for our crops (shared materials, tinted once). */
const CROP_TINT: Partial<Record<SpeciesId, Record<string, number>>> = {
  rice: { woodInner: 0xb99b3e, _defaultMat: 0xe6b84a },
  pumpkin: { leafsFall: 0xe8701a },
};

function tintCrop(root: THREE.Object3D, species: SpeciesId) {
  const map = CROP_TINT[species];
  if (!map) return;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    const mat = m.isMesh ? (m.material as THREE.MeshStandardMaterial) : null;
    const hex = mat ? map[mat.name] : undefined;
    if (mat && hex !== undefined) mat.color.setHex(hex);
  });
}

/** Tints every material of one actor (its own copies, freed with it). */
function tintAll(root: THREE.Object3D, hex: number) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.color.setHex(hex);
    mat.userData.owned = true;
    m.material = mat;
  });
}

/** Frees materials this view created for one object (shared model data is kept). */
function disposeOwned(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    const mat = m.material as THREE.Material | undefined;
    if (mat?.userData?.owned) mat.dispose();
  });
}

/** A sunflower head: brown centre and a ring of yellow petals, facing the camera. */
function sunflowerHead(r: number, stemHeight: number) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.05, 16), std(0x6b3e1e));
  disc.rotation.x = Math.PI / 2;
  g.add(disc);
  for (let i = 0; i < 12; i++) {
    const petal = new THREE.Mesh(new THREE.ConeGeometry(r * 0.22, r * 0.75, 4), std(0xfbc02d, 0.6));
    const a = (i / 12) * Math.PI * 2;
    petal.position.set(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, 0);
    petal.rotation.z = a - Math.PI / 2;
    g.add(petal);
  }
  g.position.y = stemHeight * 0.95;
  g.rotation.x = -0.35;
  return g;
}

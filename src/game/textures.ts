// Procedural 16×16 pixel art, drawn once into Phaser textures at boot.
// Keeps the prototype asset-free; real sprite sheets can replace these keys later.
import Phaser from 'phaser';
import { SPECIES, SPECIES_IDS } from '../sim/species';

export const TILE = 16;

type Ctx = CanvasRenderingContext2D;

/** Deterministic noise so tiles look hand-placed but identical every load. */
function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

function make(scene: Phaser.Scene, key: string, draw: (c: Ctx) => void, w = TILE, h = TILE) {
  const tex = scene.textures.createCanvas(key, w, h)!;
  draw(tex.getContext());
  tex.refresh();
}

function fill(c: Ctx, color: string, x: number, y: number, w = 1, h = 1) {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
}

function speckle(c: Ctx, base: string, dots: string[], seed: number, n = 14) {
  fill(c, base, 0, 0, TILE, TILE);
  const r = rng(seed);
  for (let i = 0; i < n; i++) fill(c, dots[i % dots.length], Math.floor(r() * 16), Math.floor(r() * 16));
}

/** Draws ASCII pixel art; '.' is transparent. */
function art(c: Ctx, rows: string[], palette: Record<string, string>, ox = 0, oy = 0) {
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== '.' && palette[ch]) fill(c, palette[ch], ox + x, oy + y);
    }),
  );
}

const PLAYER_DOWN = [
  '................',
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HSSSSSSH....',
  '....SESSSSES....',
  '....SSSSSSSS....',
  '.....SSRRSS.....',
  '....CCCCCCCC....',
  '...SCCCCCCCCS...',
  '...SCCCCCCCCS...',
  '....CCCCCCCC....',
  '....PPPPPPPP....',
  '....PP....PP....',
  '....PP....PP....',
  '....BB....BB....',
  '................',
];
const PLAYER_UP = PLAYER_DOWN.map((r, i) => (i >= 3 && i <= 6 ? '....HHHHHHHH....' : r));
const PLAYER_SIDE = PLAYER_DOWN.map((r, i) => (i === 4 ? '....SSSSSSES....' : i === 6 ? '.....SSSSRS.....' : r));

export const AVATARS = {
  phu: { H: '#3b2a20', S: '#f1c9a5', E: '#222', R: '#d9846b', C: '#3f7fbf', P: '#3c4a5c', B: '#4a3426' },
  su: { H: '#1f1414', S: '#f6d3b8', E: '#222', R: '#e98b8b', C: '#e07a9a', P: '#f2e6d0', B: '#7a4a3a' },
};

export function buildTextures(scene: Phaser.Scene) {
  make(scene, 'grass', (c) => speckle(c, '#7bbf5a', ['#6aad4b', '#8fd06a', '#5f9f42'], 7, 18));
  make(scene, 'grass2', (c) => {
    speckle(c, '#7bbf5a', ['#6aad4b', '#8fd06a'], 11, 10);
    art(c, ['..y..', '.yoy.', '..y..'], { y: '#fff4a8', o: '#f4a640' }, 5, 6);
  });
  make(scene, 'path', (c) => speckle(c, '#d8c08e', ['#c8ae7a', '#e6d2a6'], 3, 16));
  make(scene, 'soil', (c) => speckle(c, '#9a6b43', ['#87593a', '#ad7c52'], 5, 20));
  make(scene, 'soil_wet', (c) => speckle(c, '#5e3f28', ['#4e321f', '#6e4b30'], 5, 20));
  make(scene, 'water', (c) => {
    speckle(c, '#4a9fd8', ['#68b6e8', '#3d8cc4'], 9, 12);
    fill(c, '#a8dcff', 3, 5, 4, 1);
    fill(c, '#a8dcff', 9, 11, 3, 1);
  });
  make(scene, 'fence', (c) => {
    fill(c, '#a4744a', 0, 6, 16, 2);
    fill(c, '#a4744a', 0, 11, 16, 2);
    fill(c, '#7a5232', 2, 3, 3, 13);
    fill(c, '#7a5232', 11, 3, 3, 13);
  });
  make(scene, 'tree', (c) =>
    art(
      c,
      [
        '.....GGGGGG.....',
        '...GGGgGGGGGG...',
        '..GGgGGGGgGGGG..',
        '.GGGGGGGGGGgGGG.',
        '.GgGGGGgGGGGGGG.',
        'GGGGGGGGGGGGgGGG',
        'GGGgGGGGGGGGGGGG',
        '.GGGGGGGgGGGGGG.',
        '.GGGGGGGGGGGgGG.',
        '..GGGGGGGGGGGG..',
        '....GGGGGGGG....',
        '.......TT.......',
        '.......TT.......',
        '......TTTT......',
        '.....TTTTTT.....',
        '................',
      ],
      { G: '#3f8f3a', g: '#62b04e', T: '#6b4428' },
    ),
  );
  make(
    scene,
    'house',
    (c) => {
      // 4×3 tiles: roof, wall, door, window.
      fill(c, '#b5533c', 0, 4, 64, 20);
      for (let x = 0; x < 64; x += 4) fill(c, '#93402d', x, 4 + ((x / 4) % 2) * 2, 2, 20);
      fill(c, '#7a2f22', 0, 22, 64, 2);
      fill(c, '#efe0c0', 4, 24, 56, 22);
      fill(c, '#7a5232', 26, 30, 12, 16);
      fill(c, '#e2b04a', 35, 38, 2, 2);
      fill(c, '#8fd0f0', 9, 30, 10, 8);
      fill(c, '#8fd0f0', 45, 30, 10, 8);
      fill(c, '#7a5232', 9, 33, 10, 1);
      fill(c, '#7a5232', 45, 33, 10, 1);
    },
    64,
    48,
  );
  make(scene, 'bin', (c) =>
    art(
      c,
      [
        '................',
        '..WWWWWWWWWWWW..',
        '.WwwwwwwwwwwwwW.',
        '.WWWWWWWWWWWWWW.',
        '.WwwwwwwwwwwwwW.',
        '.WwwwwwwwwwwwwW.',
        '.WWWWWWWWWWWWWW.',
        '.WwwwwwwwwwwwwW.',
        '.WwwwwRRRRwwwwW.',
        '.WWWWWWWWWWWWWW.',
        '.WwwwwwwwwwwwwW.',
        '.WwwwwwwwwwwwwW.',
        '.WWWWWWWWWWWWWW.',
        '..W..........W..',
        '................',
        '................',
      ],
      { W: '#7a5232', w: '#b98a5a', R: '#d94a4a' },
    ),
  );
  make(
    scene,
    'stall',
    (c) => {
      for (let x = 0; x < 32; x += 4) fill(c, x % 8 ? '#f4f0e6' : '#e0533f', x, 2, 4, 8);
      fill(c, '#7a5232', 2, 10, 2, 20);
      fill(c, '#7a5232', 28, 10, 2, 20);
      fill(c, '#a4744a', 0, 18, 32, 6);
      fill(c, '#e53950', 5, 15, 3, 3);
      fill(c, '#fbc02d', 12, 15, 3, 3);
      fill(c, '#4caf50', 20, 15, 4, 3);
    },
    32,
    32,
  );
  make(scene, 'board', (c) => {
    fill(c, '#7a5232', 3, 9, 2, 7);
    fill(c, '#7a5232', 11, 9, 2, 7);
    fill(c, '#b98a5a', 1, 2, 14, 9);
    fill(c, '#7a5232', 1, 2, 14, 1);
    fill(c, '#fdf8ec', 3, 4, 4, 5);
    fill(c, '#fdf8ec', 9, 4, 4, 4);
    fill(c, '#d94a4a', 4, 4, 2, 1);
    fill(c, '#d94a4a', 10, 4, 2, 1);
  });
  make(scene, 'mailbox', (c) => {
    fill(c, '#7a5232', 7, 8, 2, 8);
    fill(c, '#d94a4a', 3, 3, 10, 6);
    fill(c, '#b33a3a', 3, 8, 10, 1);
    fill(c, '#fdf8ec', 5, 5, 4, 2);
    fill(c, '#ffd54a', 12, 2, 1, 4);
    fill(c, '#ffd54a', 13, 2, 2, 2);
  });
  make(scene, 'heart', (c) =>
    art(c, ['.RR.RR.', 'RRRRRRR', 'RRRRRRR', '.RRRRR.', '..RRR..', '...R...'], { R: '#ff5f8a' }, 4, 5),
  );
  make(scene, 'sparkle', (c) => {
    fill(c, '#fff6a8', 7, 2, 2, 4);
    fill(c, '#fff6a8', 5, 3, 6, 2);
    fill(c, '#ffffff', 7, 3, 2, 2);
    fill(c, '#fff6a8', 12, 9, 1, 3);
    fill(c, '#fff6a8', 11, 10, 3, 1);
  });
  // Memory Tree, stages 1–4 (stage 0 is the 'sapling' prop texture).
  for (let st = 1; st <= 4; st++) {
    const size = st <= 1 ? 16 : st === 2 ? 24 : 32;
    make(
      scene,
      `memtree_${st}`,
      (c) => {
        const cx = size / 2;
        const trunkH = Math.round(size * 0.35);
        fill(c, '#7a5232', cx - 1, size - trunkH, 2 + (st > 2 ? 1 : 0), trunkH);
        const r = Math.round(size * 0.32);
        const cy = size - trunkH - r + 2;
        for (let y = -r; y <= r; y++) {
          for (let x = -r - 1; x <= r + 1; x++) {
            if (x * x + y * y * 1.3 <= r * r) fill(c, (x + y) % 3 === 0 ? '#62b04e' : '#3f8f3a', cx + x, cy + y);
          }
        }
        // Blossoms: more with each stage, one per memory feel.
        const r2 = rng(st * 7);
        for (let i = 0; i < st * 3; i++) {
          fill(c, '#f7a8c4', cx + Math.round((r2() - 0.5) * r * 1.6), cy + Math.round((r2() - 0.5) * r * 1.4));
        }
      },
      size,
      size,
    );
  }
  for (const frame of [0, 1]) {
    make(scene, `chicken_${frame}`, (c) =>
      art(
        c,
        [
          '................',
          '................',
          '.......RR.......',
          '......WWWW......',
          '......WEWWY.....',
          '......WWWWYY....',
          '..W...WWWW......',
          '..WWWWWWWWW.....',
          '..WWWWWWWWWW....',
          '...WWWWWWWWW....',
          '....WWWWWWW.....',
          '.....WWWWW......',
          frame ? '.....Y...Y......' : '......Y.Y.......',
          frame ? '....YY..YY......' : '.....YY.YY......',
          '................',
          '................',
        ],
        { W: '#fdfaf0', E: '#222', R: '#e0433a', Y: '#f2a33a' },
      ),
    );
  }
  make(scene, 'egg_4', (c) =>
    art(
      c,
      ['....', '.EE.', 'EEEE', 'EEEE', 'EEEE', '.EE.'].map((r) => r),
      { E: '#f6ead2' },
      6,
      5,
    ),
  );
  make(
    scene,
    'coop',
    (c) => {
      fill(c, '#a24a32', 0, 6, 32, 10);
      for (let x = 0; x < 32; x += 4) fill(c, '#86382a', x, 6 + ((x / 4) % 2), 2, 10);
      fill(c, '#e8cf9a', 3, 16, 26, 14);
      fill(c, '#7a5232', 3, 29, 26, 2);
      fill(c, '#4a3020', 12, 20, 8, 10);
      fill(c, '#e8cf9a', 15, 26, 2, 4);
      fill(c, '#fdfaf0', 5, 19, 4, 4);
    },
    32,
    32,
  );
  make(scene, 'feeder', (c) => {
    fill(c, '#7a5232', 2, 10, 12, 4);
    fill(c, '#9a6b43', 3, 11, 10, 2);
  });
  make(scene, 'feeder_full', (c) => {
    fill(c, '#7a5232', 2, 10, 12, 4);
    fill(c, '#e2b04a', 3, 8, 10, 4);
    fill(c, '#f4d06f', 5, 8, 2, 1);
    fill(c, '#f4d06f', 9, 9, 2, 1);
  });
  make(scene, 'raindrop', (c) => fill(c, '#cfe8ff', 0, 0, 1, 3), 1, 3);
  make(scene, 'sapling', (c) =>
    art(
      c,
      [
        '................',
        '................',
        '................',
        '.......pp.......',
        '......pgGp......',
        '.....gGGgGp.....',
        '......GgGG......',
        '.......T........',
        '.......T..g.....',
        '.......TgG......',
        '.......T........',
        '.......T........',
        '......sss.......',
        '.....sssss......',
        '................',
        '................',
      ],
      { G: '#4fae4a', g: '#7fd06a', T: '#7a5232', p: '#f7a8c4', s: '#8a6a4a' },
    ),
  );

  for (const [id, pal] of Object.entries(AVATARS)) {
    make(scene, `${id}_down`, (c) => art(c, PLAYER_DOWN, pal));
    make(scene, `${id}_up`, (c) => art(c, PLAYER_UP, pal));
    make(scene, `${id}_side`, (c) => art(c, PLAYER_SIDE, pal));
  }

  for (const id of SPECIES_IDS) {
    const { leaf, fruit } = SPECIES[id].color;
    for (let st = 0; st <= 4; st++) make(scene, `${id}_${st}`, (c) => drawCrop(c, id, st, leaf, fruit));
  }
}

function drawCrop(c: Ctx, id: string, st: number, leaf: string, fruit: string) {
  const dark = '#2e5e2a';
  if (st === 0) {
    fill(c, '#e8d9a8', 5, 9);
    fill(c, '#e8d9a8', 9, 7);
    fill(c, '#e8d9a8', 10, 11);
    return;
  }
  // Stem height grows with stage.
  const h = [0, 3, 6, 9, 10][st];
  fill(c, dark, 7, 14 - h, 2, h);
  fill(c, leaf, 4, 13 - Math.floor(h / 2), 3, 2);
  fill(c, leaf, 9, 12 - Math.floor(h / 2), 3, 2);
  if (st >= 2) {
    fill(c, leaf, 3, 9 - h / 3, 4, 2);
    fill(c, leaf, 9, 8 - h / 3, 4, 2);
  }
  if (st >= 3 && id !== 'sunflower') {
    fill(c, leaf, 2, 5, 12, 6);
    fill(c, dark, 4, 7, 2, 1);
    fill(c, dark, 10, 6, 2, 1);
  }
  if (st === 4) {
    if (id === 'strawberry') {
      for (const [x, y] of [
        [3, 9],
        [7, 6],
        [11, 9],
        [9, 11],
      ]) {
        fill(c, fruit, x, y, 2, 2);
        fill(c, '#fff3', x, y);
      }
    } else if (id === 'rose') {
      for (const [x, y] of [
        [4, 4],
        [9, 3],
        [6, 8],
      ]) {
        fill(c, fruit, x, y, 3, 3);
        fill(c, '#f27a90', x, y, 1, 1);
      }
    } else if (id === 'sunflower') {
      fill(c, fruit, 4, 0, 8, 7);
      fill(c, '#6b3e1e', 6, 2, 4, 3);
    } else {
      fill(c, fruit, 3, 3, 10, 3);
      fill(c, '#7fd06a', 5, 2, 6, 1);
    }
  } else if (st === 3 && id === 'sunflower') {
    fill(c, '#9ccc65', 6, 1, 4, 4);
  }
}

/** Draws an avatar onto a plain canvas (used by the lobby before Phaser starts). */
export function drawAvatar(cv: HTMLCanvasElement, look: keyof typeof AVATARS) {
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, cv.width, cv.height);
  art(c, PLAYER_DOWN, AVATARS[look]);
}

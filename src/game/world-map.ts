// The homestead layout. Plain data so the scene, tests and later zones share one source.
export const MAP_W = 32;
export const MAP_H = 22;

export type Ground = 'grass' | 'path' | 'water' | 'fence' | 'tree' | 'field';

export interface Prop {
  id:
    | 'house'
    | 'bin'
    | 'stall'
    | 'sapling'
    | 'board'
    | 'mailbox'
    | 'coop'
    | 'feeder'
    | 'meadow'
    | 'river'
    | 'co_ba'
    | 'ong_minh';
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PROPS: Prop[] = [
  { id: 'house', x: 3, y: 2, w: 4, h: 3 },
  { id: 'bin', x: 9, y: 4, w: 1, h: 1 },
  { id: 'stall', x: 24, y: 3, w: 2, h: 2 },
  { id: 'sapling', x: 15, y: 3, w: 1, h: 1 },
  { id: 'board', x: 21, y: 4, w: 1, h: 1 },
  { id: 'mailbox', x: 7, y: 4, w: 1, h: 1 },
  { id: 'coop', x: 2, y: 8, w: 2, h: 2 },
  { id: 'feeder', x: 5, y: 9, w: 1, h: 1 },
  // Inside the gated zones: the meadow's gathering spot and the river garden's fishing spot.
  { id: 'meadow', x: 16, y: 19, w: 1, h: 1 },
  { id: 'river', x: 29, y: 10, w: 1, h: 1 },
  // Villagers: Cô Ba by the seed stall, Ông Minh by the order board.
  { id: 'co_ba', x: 23, y: 5, w: 1, h: 1 },
  { id: 'ong_minh', x: 20, y: 5, w: 1, h: 1 },
];

/** Gated areas inside the homestead, each opened by a Garden Heart unlock. */
export interface Zone {
  id: 'meadow' | 'river';
  gate: [number, number];
  /** Fence tiles around the zone (the gate tile excluded). */
  fence: Array<[number, number]>;
}

const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
export const ZONES: Zone[] = [
  {
    // South of the field: the field fence is its north side, trees its south side.
    id: 'meadow',
    gate: [23, 19],
    fence: [...span(18, 20).map((y): [number, number] => [8, y]), [23, 18], [23, 20]],
  },
  {
    // East of the path, by the tree border.
    id: 'river',
    gate: [26, 9],
    fence: [
      [26, 8],
      [26, 10],
      [26, 11],
      ...span(27, 30).map((x): [number, number] => [x, 7]),
      ...span(27, 30).map((x): [number, number] => [x, 12]),
    ],
  },
];

let openZones = new Set<string>();
/** Called whenever the garden's XP changes, so collision follows the unlocks. */
export function setOpenZones(ids: string[]) {
  openZones = new Set(ids);
}

export function gateAt(x: number, y: number): Zone | undefined {
  return ZONES.find((z) => z.gate[0] === x && z.gate[1] === y);
}

export const FIELD = { x0: 9, y0: 9, x1: 22, y1: 16 };
const POND = { x0: 25, y0: 13, x1: 29, y1: 18 };
const GATE = new Set(['15,8', '16,8']);

export function buildGround(): Ground[][] {
  const g: Ground[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    const row: Ground[] = [];
    for (let x = 0; x < MAP_W; x++) {
      let k: Ground = 'grass';
      const border = x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
      if (border) k = 'tree';
      else if (x >= FIELD.x0 && x <= FIELD.x1 && y >= FIELD.y0 && y <= FIELD.y1) k = 'field';
      else if (
        x >= FIELD.x0 - 1 &&
        x <= FIELD.x1 + 1 &&
        y >= FIELD.y0 - 1 &&
        y <= FIELD.y1 + 1 &&
        !GATE.has(`${x},${y}`)
      )
        k = 'fence';
      else if (x >= POND.x0 && x <= POND.x1 && y >= POND.y0 && y <= POND.y1) k = 'water';
      else if (ZONES.some((z) => z.fence.some(([fx, fy]) => fx === x && fy === y))) k = 'fence';
      else if (y === 6 && x >= 2 && x <= 28) k = 'path';
      else if (x === 5 && y === 5) k = 'path';
      else if ((x === 15 || x === 16) && y === 7) k = 'path';
      row.push(k);
    }
    g.push(row);
  }
  return g;
}

/** The pond or the river's fishing spot: facing either opens the fishing card. */
export const isPondTile = (x: number, y: number) => GROUND[y]?.[x] === 'water' || propAt(x, y)?.id === 'river';

export const isFieldTile = (x: number, y: number) => x >= FIELD.x0 && x <= FIELD.x1 && y >= FIELD.y0 && y <= FIELD.y1;

export function propAt(x: number, y: number): Prop | undefined {
  return PROPS.find((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
}

export const BLOCKING: Ground[] = ['water', 'fence', 'tree'];
export const SPAWN = { x: 15, y: 7 };
/** Where chickens wander, in pixels (left of the field fence). */
export const PEN = { x0: 1.5 * 16, y0: 10.5 * 16, x1: 7.5 * 16, y1: 16 * 16 };

const GROUND = buildGround();

/** Walls for the farmer: trees, fences, water and every prop's footprint. */
export function isBlocked(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return true;
  const gate = gateAt(x, y);
  if (gate && !openZones.has(gate.id)) return true;
  return BLOCKING.includes(GROUND[y][x]) || !!propAt(x, y);
}

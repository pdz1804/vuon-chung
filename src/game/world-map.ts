// The homestead layout. Plain data so the scene, tests and later zones share one source.
export const MAP_W = 32;
export const MAP_H = 22;

export type Ground = 'grass' | 'path' | 'water' | 'fence' | 'tree' | 'field';

export interface Prop {
  id: 'house' | 'bin' | 'stall' | 'sapling' | 'board' | 'mailbox' | 'coop' | 'feeder';
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
];

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
      else if (y === 6 && x >= 2 && x <= 28) k = 'path';
      else if (x === 5 && y === 5) k = 'path';
      else if ((x === 15 || x === 16) && y === 7) k = 'path';
      row.push(k);
    }
    g.push(row);
  }
  return g;
}

export const isFieldTile = (x: number, y: number) => x >= FIELD.x0 && x <= FIELD.x1 && y >= FIELD.y0 && y <= FIELD.y1;

export function propAt(x: number, y: number): Prop | undefined {
  return PROPS.find((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
}

export const BLOCKING: Ground[] = ['water', 'fence', 'tree'];
export const SPAWN = { x: 15, y: 7 };
/** Where chickens wander, in pixels (left of the field fence). */
export const PEN = { x0: 2 * 16 + 6, y0: 10.5 * 16, x1: 6.6 * 16, y1: 15 * 16 };

import { HOUR } from './growth';

export type SpeciesId = 'rau_muong' | 'strawberry' | 'sunflower' | 'rose' | 'pumpkin' | 'rice';

export interface Species {
  id: SpeciesId;
  seedCost: number;
  /** Hydrated time needed for the first harvest. */
  growMs: number;
  /** If set, the plant stays after harvest and regrows in this much hydrated time. */
  regrowMs?: number;
  /** Items per harvest. */
  yield: number;
  /** Sell price of a 1-star item; 2★ = ×1.25, 3★ = ×1.5. */
  sellPrice: number;
  xp: number;
  /** Flowers count for the Florist role; everything else for the Grower. */
  flower?: boolean;
  /** Feature key from progression.UNLOCKS; absent = available from the start. */
  unlock?: string;
  /** Pixel colours used by the procedural sprite. */
  color: { leaf: string; fruit: string };
}

export const SPECIES: Record<SpeciesId, Species> = {
  rau_muong: {
    id: 'rau_muong',
    seedCost: 5,
    growMs: 4 * HOUR,
    yield: 1,
    sellPrice: 12,
    xp: 2,
    color: { leaf: '#4caf50', fruit: '#2e7d32' },
  },
  strawberry: {
    id: 'strawberry',
    seedCost: 15,
    growMs: 12 * HOUR,
    regrowMs: 8 * HOUR,
    yield: 2,
    sellPrice: 8,
    xp: 3,
    color: { leaf: '#43a047', fruit: '#e53950' },
  },
  sunflower: {
    id: 'sunflower',
    seedCost: 20,
    growMs: 24 * HOUR,
    yield: 1,
    sellPrice: 45,
    xp: 5,
    flower: true,
    color: { leaf: '#558b2f', fruit: '#fbc02d' },
  },
  rose: {
    id: 'rose',
    seedCost: 30,
    growMs: 48 * HOUR,
    yield: 1,
    sellPrice: 80,
    xp: 8,
    flower: true,
    unlock: 'rose',
    color: { leaf: '#3d8b3a', fruit: '#d6344f' },
  },
  pumpkin: {
    id: 'pumpkin',
    seedCost: 40,
    growMs: 72 * HOUR,
    yield: 1,
    sellPrice: 140,
    xp: 12,
    unlock: 'pumpkin',
    color: { leaf: '#5a9a3a', fruit: '#f08a24' },
  },
  rice: {
    id: 'rice',
    seedCost: 10,
    growMs: 24 * HOUR,
    yield: 2,
    sellPrice: 15,
    xp: 4,
    unlock: 'rice',
    color: { leaf: '#7cb342', fruit: '#e8d27a' },
  },
};

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];

/** Sellable things that aren't crops (animal products). */
export const PRODUCTS: Record<string, number> = {
  egg: 30,
  duck_egg: 45,
  milk: 90,
  // Kitchen dishes (see kitchen.ts).
  rau_xao: 75,
  mut_dau: 70,
  bo_hoa: 260,
  com_trung: 90,
  banh_flan: 230,
  che_bi_do: 300,
};

export function sellPrice(id: string, stars: number): number {
  const base = (SPECIES as Record<string, Species | undefined>)[id]?.sellPrice ?? PRODUCTS[id] ?? 0;
  return Math.round(base * (1 + 0.25 * (stars - 1)));
}

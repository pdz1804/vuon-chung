// What the game controller needs from a renderer. Keeping this small lets the
// rules, networking and HUD stay independent of how the farm is drawn.
import type { Pose } from '../net/presence';
import type { Look, Profile } from '../net/world-store';
import type { FarmState } from '../sim/farm';

export type Facing = 'down' | 'up' | 'left' | 'right';

export const DIRS: Record<Facing, [number, number]> = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };

/** Presence positions are sent in "pixels" (16 per tile) so every client version agrees. */
export const PX_PER_TILE = 16;

export interface FarmView {
  /** Builds the scene into `parent` and starts the render loop. */
  mount(parent: HTMLElement, look: Look): Promise<void>;
  /** Called once per frame with the frame time, before drawing. */
  onFrame(cb: (dtMs: number) => void): void;
  /** Moves the farmer by an input vector (-1..1 each axis) for this frame. */
  move(vx: number, vy: number, dtMs: number, speedMul: number): void;
  /** Farmer position in tile units and facing. */
  readonly player: { x: number; y: number; facing: Facing; moving: boolean };
  /** The tile the farmer faces. */
  target(): [number, number];
  /** Id of the animal standing nearest to a tile, if one is close enough to use. */
  animalAt(tx: number, ty: number): string | null;
  /** Redraws everything that depends on farm state. */
  drawFarm(farm: FarmState, now: number, uid: string): void;
  /** Night darkness 0..1 and rain. */
  setEnvironment(night: number, raining: boolean): void;
  /** A partner appeared, moved, or left (null). */
  partner(uid: string, pose: Pose | null, profile: Profile | undefined): void;
  /** Partner positions in tile units (for "walk together"). */
  partnerPositions(): Array<{ x: number; y: number; moving: boolean }>;
  /** Emote bubble over the player ('me') or a partner uid. */
  bubble(who: string, emoji: string): void;
  /** A short "you did something" animation on the farmer. */
  playAction(): void;
  /** Level-up flourish. */
  celebrate(): void;
}

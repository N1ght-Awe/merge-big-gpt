import { GAME, LEVELS } from './config';

export const SAVE_KEY = 'merge-big-gpt.round.v1';

export interface SavedRound {
  version: 1;
  score: number;
  currentLevel: number;
  nextLevel: number;
  maxLevel: number;
  drops: number;
  merges: number;
  combo: number;
  time: number;
  aimX: number;
  dropAge: number | null;
  mergeAge: number | null;
  crowned: boolean;
  pieces: Array<{
    level: number; x: number; y: number; vx: number; vy: number;
    angle: number; angularVelocity: number; bornAt: number; overflowEligible: boolean;
  }>;
}

/** Validate the complete snapshot before touching the live Matter world. */
export function isSavedRound(value: unknown): value is SavedRound {
  if (!value || typeof value !== 'object') return false;
  const data = value as SavedRound;
  const finite = (n: unknown, min: number, max: number): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  const integer = (n: unknown, max = Number.MAX_SAFE_INTEGER): n is number =>
    finite(n, 0, max) && Number.isInteger(n);
  const age = (n: unknown) => n === null || finite(n, 0, data.time);
  return data.version === 1 && integer(data.score) && integer(data.drops) && integer(data.merges)
    && integer(data.combo) && integer(data.currentLevel, 3) && integer(data.nextLevel, 3)
    && integer(data.maxLevel, LEVELS.length - 1) && finite(data.time, 0, 1e12)
    && finite(data.aimX, GAME.wall, GAME.width - GAME.wall) && age(data.dropAge) && age(data.mergeAge)
    && typeof data.crowned === 'boolean' && Array.isArray(data.pieces)
    && data.pieces.length > 0 && data.pieces.length <= 500
    && data.pieces.every(p => p && integer(p.level, data.maxLevel)
      && finite(p.x, GAME.wall + LEVELS[p.level].radius - 1, GAME.width - GAME.wall - LEVELS[p.level].radius + 1)
      && finite(p.y, -GAME.height * 2, GAME.floorY - LEVELS[p.level].radius + 1)
      && finite(p.vx, -100, 100) && finite(p.vy, -100, 100)
      && finite(p.angle, -1e9, 1e9) && finite(p.angularVelocity, -100, 100)
      && finite(p.bornAt, 0, data.time) && typeof p.overflowEligible === 'boolean');
}

export function readSavedRound(): SavedRound | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
    return isSavedRound(value) ? value : null;
  } catch { return null; }
}

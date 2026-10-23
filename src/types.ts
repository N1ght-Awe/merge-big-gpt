import type { Body } from 'matter-js';

/** All game level references are zero-based (0..10); config.id is display-only (1..11). */
export interface LevelConfig {
  id: number;
  name: string;
  radius: number;
  color: string;
  accent: string;
  image: string;
  quip: string;
  score: number;
}
export type GameStatus = 'playing' | 'paused' | 'gameover';
export interface PhysicsState {
  status: GameStatus;
  score: number;
  currentLevel: number;
  nextLevel: number;
  combo: number;
  maxLevel: number;
  drops: number;
  merges: number;
  canDrop: boolean;
  time: number;
  aimX: number;
}
export interface GameState extends PhysicsState {
  best: number;
  muted: boolean;
}
export interface GamePiece {
  body: Body;
  level: number;
  bornAt: number;
  /** Has contacted the floor/stack; airborne drops do not warn when crossing the line. */
  overflowEligible: boolean;
}
export type PhysicsEvent =
  | { type: 'merge'; level: number; x: number; y: number; combo: number; points: number }
  | { type: 'drop'; level: number; x: number; y: number }
  | { type: 'gameover' }
  | { type: 'crown'; x: number; y: number };

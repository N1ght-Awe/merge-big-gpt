import Matter from 'matter-js';
import type { Engine, IEventCollision } from 'matter-js';
import { GAME, LEVELS } from './config';
import type { GamePiece, GameStatus, PhysicsEvent, PhysicsState } from './types';

const { Bodies, Body: MatterBody, Composite, Engine: MatterEngine, Events } = Matter;
const FIXED_STEP = 1000 / 60;

/**
 * Owns both the authoritative game state and its Matter bodies.
 * Collision callbacks only collect candidates. Bodies are consumed in one
 * transaction after Engine.update, never while Matter is iterating its pairs.
 */
export class PhysicsGame {
  readonly engine: Engine;
  readonly pieces = new Map<number, GamePiece>();

  private status: GameStatus = 'playing';
  private score = 0;
  private currentLevel = 0;
  private nextLevel = 0;
  private combo = 0;
  private maxLevel = 0;
  private drops = 0;
  private merges = 0;
  private warning = 0;
  private time = 0;
  private aimX: number = GAME.width / 2;
  private lastDrop = -Infinity;
  private lastMerge = -Infinity;
  private crowned = false;
  private destroyed = false;
  private pendingPairs = new Map<string, readonly [number, number]>();
  private pendingContacts: Array<readonly [number, number]> = [];
  private pendingEvents: PhysicsEvent[] = [];

  constructor(
    private readonly onEvent: (event: PhysicsEvent) => void = () => {},
    private readonly random: () => number = Math.random,
  ) {
    this.engine = MatterEngine.create({
      gravity: { x: 0, y: 1.15, scale: 0.001 },
      positionIterations: 8,
      velocityIterations: 8,
      constraintIterations: 2,
      enableSleeping: false,
    });
    Events.on(this.engine, 'collisionStart', this.collectCollisions);
    Events.on(this.engine, 'collisionActive', this.collectCollisions);
    this.reset();
  }

  snapshot(): PhysicsState {
    return {
      status: this.status,
      score: this.score,
      currentLevel: this.currentLevel,
      nextLevel: this.nextLevel,
      combo: this.combo,
      maxLevel: this.maxLevel,
      drops: this.drops,
      merges: this.merges,
      warning: this.warning,
      canDrop: !this.destroyed && this.status === 'playing'
        && this.time - this.lastDrop >= GAME.dropCooldown,
      time: this.time,
      aimX: this.aimX,
    };
  }

  aim(x: number): void {
    if (!Number.isFinite(x) || this.destroyed) return;
    this.aimX = this.clampX(x, this.currentLevel);
  }

  drop(): boolean {
    if (!this.snapshot().canDrop) return false;
    const level = this.currentLevel;
    const piece = this.spawn(level, this.aimX, GAME.spawnY);
    this.lastDrop = this.time;
    this.drops += 1;
    this.currentLevel = this.nextLevel;
    this.nextLevel = this.rollLevel();
    this.aimX = this.clampX(this.aimX, this.currentLevel);
    this.pendingEvents.push({
      type: 'drop', level, x: piece.body.position.x, y: piece.body.position.y,
    });
    this.flushEvents();
    return true;
  }

  /** Also used by deterministic tests and the development-only scene tools. */
  spawn(level: number, x: number, y: number): GamePiece {
    if (this.destroyed) throw new Error('Cannot spawn into a destroyed game.');
    if (!Number.isInteger(level) || level < 0 || level >= LEVELS.length) {
      throw new RangeError(`Unknown character level: ${level}`);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError('Piece position must be finite.');
    }
    const radius = LEVELS[level].radius;
    const body = Bodies.circle(
      this.clampX(x, level),
      Math.min(y, GAME.floorY - radius),
      radius,
      {
        label: `gpt-level-${level}`,
        restitution: 0.12,
        friction: 0.38,
        frictionStatic: 0.85,
        frictionAir: 0.008,
        density: 0.0015,
        slop: 0.03,
      },
    );
    const piece: GamePiece = {
      body,
      level,
      bornAt: this.time,
      overflowEligible: body.position.y + radius >= GAME.deadline,
    };
    Composite.add(this.engine.world, body);
    this.pieces.set(body.id, piece);
    this.maxLevel = Math.max(this.maxLevel, level);
    if (level === LEVELS.length - 1 && !this.crowned) {
      this.crowned = true;
      this.pendingEvents.push({ type: 'crown', x: body.position.x, y: body.position.y });
    }
    return piece;
  }

  step(deltaMs: number): void {
    if (this.destroyed || this.status !== 'playing'
      || !Number.isFinite(deltaMs) || deltaMs <= 0) return;
    // Substeps also keep callers passing an occasional longer frame safe.
    let remaining = deltaMs;
    while (remaining > 0.00001 && this.status === 'playing') {
      const dt = Math.min(remaining, FIXED_STEP);
      this.time += dt;
      if (this.time - this.lastMerge > GAME.comboWindow) this.combo = 0;
      this.pendingContacts.length = 0;
      MatterEngine.update(this.engine, dt);
      this.updateOverflowEligibility();
      this.commitMerges();
      this.containPieces();
      this.checkOverflow();
      this.flushEvents();
      remaining -= dt;
    }
  }

  pause(): void {
    if (!this.destroyed && this.status === 'playing') this.status = 'paused';
  }

  resume(): void {
    if (!this.destroyed && this.status === 'paused') this.status = 'playing';
  }

  reset(): void {
    if (this.destroyed) return;
    this.pendingPairs.clear();
    this.pendingContacts.length = 0;
    this.pendingEvents.length = 0;
    this.pieces.clear();
    Composite.clear(this.engine.world, false);
    MatterEngine.clear(this.engine);
    this.engine.timing.timestamp = 0;
    this.engine.timing.lastDelta = FIXED_STEP;
    this.status = 'playing';
    this.score = 0;
    this.combo = 0;
    this.maxLevel = 0;
    this.drops = 0;
    this.merges = 0;
    this.warning = 0;
    this.time = 0;
    this.lastDrop = -Infinity;
    this.lastMerge = -Infinity;
    this.crowned = false;
    this.currentLevel = this.rollLevel();
    this.nextLevel = this.rollLevel();
    this.aimX = GAME.width / 2;
    this.addBounds();
  }

  destroy(): void {
    if (this.destroyed) return;
    Events.off(this.engine, 'collisionStart', this.collectCollisions);
    Events.off(this.engine, 'collisionActive', this.collectCollisions);
    this.pendingPairs.clear();
    this.pendingContacts.length = 0;
    this.pendingEvents.length = 0;
    this.pieces.clear();
    Composite.clear(this.engine.world, false);
    MatterEngine.clear(this.engine);
    this.destroyed = true;
    this.status = 'gameover';
  }

  private readonly collectCollisions = (event: IEventCollision<Engine>): void => {
    for (const pair of event.pairs) {
      const first = this.pieces.get(pair.bodyA.id);
      const second = this.pieces.get(pair.bodyB.id);
      if (!first || !second) continue;
      this.pendingContacts.push([first.body.id, second.body.id]);
      if (first.level !== second.level
        || first.level === LEVELS.length - 1) continue;
      const a = Math.min(first.body.id, second.body.id);
      const b = Math.max(first.body.id, second.body.id);
      this.pendingPairs.set(`${a}:${b}`, [a, b]);
    }
  };

  private updateOverflowEligibility(): void {
    // Fresh drops start above the line. Arm them by geometry/contact, not age.
    // Walls cannot arm a drop, and two airborne newcomers cannot arm each other.
    const contacts = new Map<number, number[]>();
    for (const [a, b] of this.pendingContacts) {
      if (!contacts.has(a)) contacts.set(a, []);
      if (!contacts.has(b)) contacts.set(b, []);
      contacts.get(a)!.push(b);
      contacts.get(b)!.push(a);
    }
    const eligible: number[] = [];
    for (const piece of this.pieces.values()) {
      if (piece.body.position.y + LEVELS[piece.level].radius >= GAME.deadline) {
        piece.overflowEligible = true;
      }
      if (piece.overflowEligible) eligible.push(piece.body.id);
    }
    // Traverse the contact graph so a blocked drop cannot gain permanent
    // immunity, regardless of the order Matter reports simultaneous contacts.
    for (let i = 0; i < eligible.length; i++) {
      for (const id of contacts.get(eligible[i]) ?? []) {
        const piece = this.pieces.get(id);
        if (piece && !piece.overflowEligible) {
          piece.overflowEligible = true;
          eligible.push(id);
        }
      }
    }
  }

  private commitMerges(): void {
    // Sorted IDs make a three-way collision deterministic and independently
    // consume each body at most once, regardless of Matter's callback ordering.
    const pairs = [...this.pendingPairs.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    this.pendingPairs.clear();
    for (const [aId, bId] of pairs) {
      const a = this.pieces.get(aId);
      const b = this.pieces.get(bId);
      if (!a || !b || a.level !== b.level || a.level >= LEVELS.length - 1) continue;
      const level = a.level + 1;
      const x = (a.body.position.x + b.body.position.x) / 2;
      const y = (a.body.position.y + b.body.position.y) / 2;
      const velocity = {
        x: Math.max(-6, Math.min(6, (a.body.velocity.x + b.body.velocity.x) / 2)),
        y: Math.max(-3, Math.min(5, (a.body.velocity.y + b.body.velocity.y) / 2)),
      };
      this.pieces.delete(aId);
      this.pieces.delete(bId);
      Composite.remove(this.engine.world, [a.body, b.body]);
      const merged = this.spawn(level, x, y);
      MatterBody.setVelocity(merged.body, velocity);
      // Merging does not turn an existing stack piece back into a fresh drop.
      // The resulting circle is checked after the complete merge transaction.
      merged.bornAt = Math.min(a.bornAt, b.bornAt);
      merged.overflowEligible = a.overflowEligible || b.overflowEligible || merged.overflowEligible;
      this.combo = this.time - this.lastMerge <= GAME.comboWindow ? this.combo + 1 : 1;
      this.lastMerge = this.time;
      const base = LEVELS[level].score;
      const points = base + Math.floor(base * 0.2 * (Math.min(this.combo, 8) - 1));
      this.score += points;
      this.merges += 1;
      this.pendingEvents.push({
        type: 'merge', level, x: merged.body.position.x, y: merged.body.position.y,
        combo: this.combo, points,
      });
    }
  }

  private checkOverflow(): void {
    this.warning = 0;
    for (const piece of this.pieces.values()) {
      if (!piece.overflowEligible) continue;
      const radius = LEVELS[piece.level].radius;
      const top = piece.body.position.y - radius;
      const bottom = piece.body.position.y + radius;
      this.warning = Math.max(this.warning, Math.max(0, Math.min(1, (GAME.deadline - top) / (2 * radius))));
      // A tangent circle is still safe. Only a whole circle strictly above the
      // line loses, immediately, with no entry or overflow countdown.
      if (bottom < GAME.deadline) {
        this.status = 'gameover';
        this.warning = 1;
        this.pendingEvents.push({ type: 'gameover' });
        return;
      }
    }
  }

  private containPieces(): void {
    // A new, larger merge body can deeply overlap a packed stack. Matter's
    // finite position solver can then push a small neighbor through a thin
    // wall. Project the final circle bounds back into the container each step,
    // keeping its tangential velocity and damping only outward velocity.
    for (const piece of this.pieces.values()) {
      const { body, level } = piece;
      const radius = LEVELS[level].radius;
      const minX = GAME.wall + radius;
      const maxX = GAME.width - GAME.wall - radius;
      const maxY = GAME.floorY - radius;
      const x = Math.max(minX, Math.min(maxX, body.position.x));
      const y = Math.min(maxY, body.position.y);
      if (x === body.position.x && y === body.position.y) continue;
      let vx = body.velocity.x;
      let vy = body.velocity.y;
      if ((body.position.x < minX && vx < 0) || (body.position.x > maxX && vx > 0)) vx *= -0.12;
      if (body.position.y > maxY && vy > 0) vy *= -0.08;
      MatterBody.setPosition(body, { x, y });
      MatterBody.setVelocity(body, { x: vx, y: vy });
    }
  }

  private addBounds(): void {
    const options = { isStatic: true, friction: 0.4, restitution: 0.08, slop: 0.02 };
    const wallHeight = GAME.height * 3;
    Composite.add(this.engine.world, [
      Bodies.rectangle(GAME.wall / 2, GAME.height / 2, GAME.wall, wallHeight, {
        ...options, label: 'left-wall',
      }),
      Bodies.rectangle(GAME.width - GAME.wall / 2, GAME.height / 2, GAME.wall, wallHeight, {
        ...options, label: 'right-wall',
      }),
      Bodies.rectangle(GAME.width / 2, GAME.floorY + 30, GAME.width + GAME.wall * 2, 60, {
        ...options, label: 'floor',
      }),
    ]);
  }

  private clampX(x: number, level: number): number {
    const margin = GAME.wall + LEVELS[level].radius + 0.5;
    return Math.max(margin, Math.min(GAME.width - margin, x));
  }

  private rollLevel(): number {
    const value = Math.max(0, Math.min(0.999999, this.random()));
    if (value < 0.45) return 0;
    if (value < 0.75) return 1;
    if (value < 0.93) return 2;
    return 3;
  }

  private flushEvents(): void {
    const events = this.pendingEvents.splice(0);
    for (const event of events) this.onEvent(event);
  }
}

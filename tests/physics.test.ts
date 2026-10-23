import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { GAME, LEVELS } from '../src/config';
import { PhysicsGame } from '../src/physics';
import type { PhysicsEvent } from '../src/types';

const FRAME = 1000 / 60;

function advance(game: PhysicsGame, durationMs: number): void {
  let remaining = durationMs;
  while (remaining > 0.00001) {
    const dt = Math.min(FRAME, remaining);
    game.step(dt);
    remaining -= dt;
  }
}

function assertWorldSync(game: PhysicsGame): void {
  const worldIds = Matter.Composite.allBodies(game.engine.world)
    .filter((body) => body.label.startsWith('gpt-level-'))
    .map((body) => body.id)
    .sort((a, b) => a - b);
  const pieceIds = [...game.pieces.keys()].sort((a, b) => a - b);
  assert.deepEqual(worldIds, pieceIds, 'world and authoritative piece map must match');
  assert.equal(Matter.Composite.allBodies(game.engine.world).length, game.pieces.size + 3);
}

function material(game: PhysicsGame): number {
  return [...game.pieces.values()].reduce((total, piece) => total + 2 ** piece.level, 0);
}

test('three-way real collision consumes each original body only once', () => {
  const events: PhysicsEvent[] = [];
  const game = new PhysicsGame((event) => events.push(event), () => 0);
  const radius = LEVELS[0].radius;
  const originals = [-1, 0, 1].map((offset) =>
    game.spawn(0, 220 + offset * radius * 1.75, 430));
  game.step(FRAME);
  assert.equal(game.snapshot().merges, 1);
  assert.equal(game.pieces.size, 2);
  assert.equal(material(game), 3);
  assert.equal(originals.filter((piece) => game.pieces.has(piece.body.id)).length, 1);
  assert.equal(events.filter((event) => event.type === 'merge').length, 1);
  assertWorldSync(game);
  advance(game, 1500);
  assert.equal(game.snapshot().merges, 1, 'collisionActive cannot merge retired bodies');
  assert.equal(material(game), 3);
  assertWorldSync(game);
  game.destroy();
});

test('four touching pieces conserve material through two simultaneous merges and a chain', () => {
  const events: PhysicsEvent[] = [];
  const game = new PhysicsGame((event) => events.push(event), () => 0);
  const offset = LEVELS[0].radius * 0.8;
  for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    game.spawn(0, 220 + x * offset, 430 + y * offset);
  }
  game.step(FRAME);
  assert.equal(game.snapshot().merges, 2);
  assert.equal(game.pieces.size, 2);
  assert.equal(material(game), 4);
  assertWorldSync(game);
  advance(game, 500);
  assert.equal(game.snapshot().merges, 3);
  assert.equal(game.pieces.size, 1);
  assert.equal([...game.pieces.values()][0].level, 2);
  assert.equal(material(game), 4);
  const merges = events.filter((event) => event.type === 'merge');
  assert.deepEqual(merges.map((event) => event.combo), [1, 2, 3]);
  assert.equal(game.snapshot().score, merges.reduce((total, event) => total + event.points, 0));
  assert.ok(merges[1].points >= LEVELS[1].score);
  assertWorldSync(game);
  advance(game, GAME.comboWindow + 1);
  assert.equal(game.snapshot().combo, 0, 'combo expires using simulated time');
  game.destroy();
});

test('unequal levels collide without merging', () => {
  const game = new PhysicsGame();
  game.spawn(0, 200, 500);
  game.spawn(1, 220, 500);
  advance(game, 1800);
  assert.equal(game.pieces.size, 2);
  assert.equal(game.snapshot().merges, 0);
  assertWorldSync(game);
  game.destroy();
});

test('maximum level remains physical, crown fires once, and play continues', () => {
  const events: PhysicsEvent[] = [];
  const game = new PhysicsGame((event) => events.push(event), () => 0);
  const max = LEVELS.length - 1;
  const radius = LEVELS[max - 1].radius;
  game.spawn(max - 1, 220 - radius * 0.9, 470);
  game.spawn(max - 1, 220 + radius * 0.9, 470);
  game.step(FRAME);
  assert.equal(game.snapshot().maxLevel, max);
  assert.equal(events.filter((event) => event.type === 'crown').length, 1);
  game.spawn(max, 220, 430);
  advance(game, 1000);
  assert.equal(game.pieces.size, 2);
  assert.ok([...game.pieces.values()].every((piece) => piece.level === max));
  assert.equal(game.snapshot().merges, 1);
  assert.equal(events.filter((event) => event.type === 'crown').length, 1);
  assert.equal(game.snapshot().status, 'playing');
  assert.ok(game.drop());
  assertWorldSync(game);
  game.destroy();
});

test('walls and floor retain circles, including strong side impacts', () => {
  const game = new PhysicsGame(() => {}, () => 0);
  const left = game.spawn(0, -1000, 350);
  const right = game.spawn(1, 1000, 350);
  Matter.Body.setVelocity(left.body, { x: -14, y: 8 });
  Matter.Body.setVelocity(right.body, { x: 14, y: 8 });
  advance(game, 3000);
  for (const piece of game.pieces.values()) {
    const r = LEVELS[piece.level].radius;
    assert.ok(piece.body.position.x - r >= GAME.wall - 1);
    assert.ok(piece.body.position.x + r <= GAME.width - GAME.wall + 1);
    assert.ok(piece.body.position.y + r <= GAME.floorY + 1);
  }
  assert.equal(game.snapshot().status, 'playing');
  assertWorldSync(game);
  game.destroy();
});

test('dense center and edge drops cannot squeeze small pieces through the container', () => {
  let seed = 140727;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  // Reproduces a dense real collision stack that previously pushed a small
  // character through the thin side wall during a nearby size-changing merge.
  for (let round = 0; round < 2; round++) {
    const game = new PhysicsGame(() => {}, random);
    let admitted = 0;
    for (let frame = 0; frame < 10000 && game.snapshot().status === 'playing'; frame++) {
      if (game.snapshot().canDrop) {
        admitted += 2 ** game.snapshot().currentLevel;
        game.aim(round === 0 ? 220 : random() < 0.5 ? -1000 : 1000);
        assert.ok(game.drop());
      }
      game.step(FRAME);
      for (const piece of game.pieces.values()) {
        const { x, y } = piece.body.position;
        const radius = LEVELS[piece.level].radius;
        assert.ok(Number.isFinite(x) && Number.isFinite(y));
        assert.ok(x - radius >= GAME.wall - 0.5, `left wall: round=${round} frame=${frame}`);
        assert.ok(x + radius <= GAME.width - GAME.wall + 0.5, `right wall: round=${round} frame=${frame}`);
        assert.ok(y + radius <= GAME.floorY + 0.5, `floor: round=${round} frame=${frame}`);
      }
      assert.equal(material(game), admitted);
      assertWorldSync(game);
    }
    assert.equal(game.snapshot().status, 'gameover', 'a full container must eventually end the round');
    game.destroy();
  }
});

test('drop cooldown, aim clamps, preview advancement, and weighted level bounds', () => {
  const values = [0, 0.6, 0.8, 0.99];
  let index = 0;
  const game = new PhysicsGame(() => {}, () => values[index++ % values.length]);
  assert.equal(game.snapshot().currentLevel, 0);
  assert.equal(game.snapshot().nextLevel, 1);
  game.aim(-1000);
  assert.ok(game.drop());
  assert.equal(game.snapshot().currentLevel, 1);
  assert.equal(game.snapshot().nextLevel, 2);
  const dropped = [...game.pieces.values()][0];
  assert.ok(dropped.body.position.x - LEVELS[0].radius >= GAME.wall);
  assert.equal(game.drop(), false);
  advance(game, GAME.dropCooldown - 1);
  assert.equal(game.drop(), false);
  advance(game, 2);
  game.aim(1000);
  assert.ok(game.drop());
  assert.equal(game.snapshot().currentLevel, 2);
  assert.equal(game.snapshot().nextLevel, 3);
  assert.equal(game.snapshot().drops, 2);
  assertWorldSync(game);
  game.destroy();
});

test('pause freezes simulation and cooldown; reset removes all old entities', () => {
  const events: PhysicsEvent[] = [];
  const game = new PhysicsGame((event) => events.push(event), () => 0);
  game.drop();
  advance(game, 100);
  const piece = [...game.pieces.values()][0];
  const position = { ...piece.body.position };
  const before = game.snapshot();
  game.pause();
  advance(game, 6000);
  assert.equal(game.snapshot().time, before.time);
  assert.deepEqual(piece.body.position, position);
  assert.equal(game.drop(), false);
  game.resume();
  advance(game, 100);
  assert.ok(piece.body.position.y > position.y);
  game.pause();
  game.reset();
  assert.equal(game.pieces.size, 0);
  assert.equal(game.snapshot().status, 'playing');
  assert.equal(game.snapshot().score, 0);
  assert.equal(game.snapshot().drops, 0);
  assert.equal(game.snapshot().merges, 0);
  assert.equal(game.snapshot().time, 0);
  assert.equal(game.snapshot().warning, 0);
  assert.equal(game.snapshot().canDrop, true);
  assertWorldSync(game);
  assert.ok(game.drop());
  advance(game, 700);
  assert.equal(events.filter((event) => event.type === 'gameover').length, 0);
  assert.ok(!game.pieces.has(piece.body.id));
  game.destroy();
  assert.equal(game.pieces.size, 0);
  assert.equal(Matter.Composite.allBodies(game.engine.world).length, 0);
  assert.equal(game.drop(), false);
});

test('normal new drops cross the danger line without false game over', () => {
  for (const value of [0, 0.6, 0.8, 0.99]) {
    const game = new PhysicsGame(() => {}, () => value);
    game.drop();
    assert.equal([...game.pieces.values()][0].overflowEligible, false);
    game.step(FRAME);
    assert.equal(game.snapshot().status, 'playing');
    advance(game, 5000);
    assert.equal(game.snapshot().status, 'playing');
    assert.equal(game.snapshot().warning, 0);
    assert.equal([...game.pieces.values()][0].overflowEligible, true);
    game.destroy();
  }
});

test('a new drop blocked above the line by the stack loses on contact, without a timer', () => {
  const events: PhysicsEvent[] = [];
  const game = new PhysicsGame((event) => events.push(event), () => 0);
  const support = game.spawn(5, 220, 130);
  Matter.Body.setStatic(support.body, true);
  assert.ok(game.drop());
  const piece = [...game.pieces.values()].find(p => p !== support)!;
  assert.equal(piece.overflowEligible, false);
  advance(game, 1000);
  assert.equal(game.snapshot().status, 'gameover');
  assert.ok(game.snapshot().time < 1000);
  assert.equal(piece.overflowEligible, true);
  assert.ok(piece.body.position.y + LEVELS[piece.level].radius < GAME.deadline);
  assert.equal(game.snapshot().warning, 1);
  assert.equal(game.drop(), false);
  game.resume();
  advance(game, 5000);
  assert.equal(events.filter((event) => event.type === 'gameover').length, 1);
  assertWorldSync(game);
  game.destroy();
});

test('partial overflow is safe indefinitely at every level, including exact bottom tangency', () => {
  for (const level of LEVELS.keys()) {
    const game = new PhysicsGame();
    const r = LEVELS[level].radius;
    const piece = game.spawn(level, 220, GAME.deadline + r);
    Matter.Body.setStatic(piece.body, true);
    for (const y of [GAME.deadline, GAME.deadline - r + 1, GAME.deadline - r]) {
      Matter.Body.setPosition(piece.body, { x: 220, y });
      advance(game, 5000);
      assert.equal(game.snapshot().status, 'playing', `level=${level}, y=${y}`);
      assert.ok(game.snapshot().warning > 0);
    }
    // Even a small strictly complete crossing loses on the next physics step.
    Matter.Body.setPosition(piece.body, { x: 220, y: GAME.deadline - r - 0.01 });
    game.step(FRAME);
    assert.equal(game.snapshot().status, 'gameover', `level=${level}`);
    assertWorldSync(game);
    game.destroy();
  }
});

test('warning follows geometry and recedes immediately when the circle moves down', () => {
  const game = new PhysicsGame();
  const r = LEVELS[0].radius;
  const piece = game.spawn(0, 220, GAME.deadline + r + 20);
  Matter.Body.setStatic(piece.body, true);
  assert.equal(piece.overflowEligible, true);
  Matter.Body.setPosition(piece.body, { x: 220, y: GAME.deadline });
  game.step(FRAME);
  assert.equal(game.snapshot().status, 'playing');
  assert.equal(game.snapshot().warning, 0.5);
  advance(game, 10000);
  assert.equal(game.snapshot().warning, 0.5, 'waiting cannot increase danger');
  Matter.Body.setPosition(piece.body, { x: 220, y: GAME.deadline + r + 20 });
  game.step(FRAME);
  assert.equal(game.snapshot().warning, 0);
  game.destroy();
});

test('two airborne newcomers or a side wall cannot arm entry failure', () => {
  const game = new PhysicsGame();
  game.engine.gravity.y = 0;
  const a = game.spawn(0, 180, GAME.spawnY);
  const b = game.spawn(1, 222, GAME.spawnY);
  const wall = game.spawn(2, GAME.wall + LEVELS[2].radius, GAME.spawnY);
  Matter.Body.setPosition(wall.body, { x: GAME.wall + LEVELS[2].radius - 1, y: GAME.spawnY });
  advance(game, 6000);
  assert.equal(game.snapshot().status, 'playing');
  assert.ok([a, b, wall].every(piece => !piece.overflowEligible));
  assert.equal(game.snapshot().warning, 0);
  game.destroy();
});

test('a contact chain propagates stack eligibility in the same physics step', () => {
  const game = new PhysicsGame();
  game.engine.gravity.y = 0;
  // Create the airborne end first to avoid relying on callback or body-ID order.
  const top = game.spawn(2, 220, 0);
  const middle = game.spawn(1, 220, 60);
  const support = game.spawn(0, 220, 106);
  Matter.Body.setStatic(support.body, true);
  game.step(FRAME);
  assert.ok(top.overflowEligible && middle.overflowEligible);
  assert.equal(game.snapshot().status, 'gameover');
  assertWorldSync(game);
  game.destroy();
});

test('a same-step merge can rescue whole-crossed parents if the resulting circle reaches the line', () => {
  const game = new PhysicsGame();
  game.engine.gravity.y = 0;
  const a = game.spawn(0, 200, 200);
  const b = game.spawn(0, 236, 200);
  Matter.Body.setPosition(a.body, { x: 200, y: 102 });
  Matter.Body.setPosition(b.body, { x: 236, y: 102 });
  game.step(FRAME);
  assert.equal(game.snapshot().merges, 1);
  assert.equal(game.snapshot().status, 'playing');
  const merged = [...game.pieces.values()][0];
  assert.ok(merged.overflowEligible);
  assert.ok(merged.body.position.y + LEVELS[merged.level].radius >= GAME.deadline);
  assertWorldSync(game);
  game.destroy();
});

test('a merged stack circle still wholly above the line loses once without renewed entry immunity', () => {
  const events: PhysicsEvent[] = [];
  const game = new PhysicsGame(event => events.push(event));
  game.engine.gravity.y = 0;
  const a = game.spawn(0, 200, 200);
  const b = game.spawn(0, 236, 80);
  Matter.Body.setPosition(a.body, { x: 200, y: 80 });
  game.step(FRAME);
  assert.equal(game.snapshot().merges, 1);
  assert.equal(game.snapshot().status, 'gameover');
  assert.ok([...game.pieces.values()][0].overflowEligible);
  assert.ok(!game.pieces.has(b.body.id));
  assert.deepEqual(events.map(event => event.type), ['merge', 'gameover']);
  advance(game, 5000);
  assert.equal(events.filter(event => event.type === 'gameover').length, 1);
  assertWorldSync(game);
  game.destroy();
});

test('invalid spawn inputs cannot corrupt the world, and invalid steps do not advance it', () => {
  const game = new PhysicsGame();
  assert.throws(() => game.spawn(-1, 220, 300), RangeError);
  assert.throws(() => game.spawn(LEVELS.length, 220, 300), RangeError);
  assert.throws(() => game.spawn(0.5, 220, 300), RangeError);
  assert.throws(() => game.spawn(0, NaN, 300), RangeError);
  assert.throws(() => game.spawn(0, 220, Infinity), RangeError);
  game.step(NaN);
  game.step(-10);
  game.step(Infinity);
  assert.equal(game.snapshot().time, 0);
  assertWorldSync(game);
  game.destroy();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import { PhysicsGame } from '../src/physics';
import { GAME, LEVELS } from '../src/config';
import type { PhysicsEvent } from '../src/types';

test('a JSON round trip restores pieces, score, preview and cooldown in a paused world', () => {
  const game = new PhysicsGame(() => {}, () => 0);
  game.spawn(0, 200, 440);
  game.spawn(0, 236, 440);
  game.step(1000 / 60);
  game.drop();
  game.step(200);
  const saved = JSON.parse(JSON.stringify(game.save()));
  const restored = new PhysicsGame();
  assert.ok(restored.restore(saved));
  assert.equal(restored.snapshot().status, 'paused');
  assert.deepEqual(restored.save(), saved);
  const positions = [...restored.pieces.values()].map(p => ({ ...p.body.position }));
  restored.step(5000);
  assert.deepEqual([...restored.pieces.values()].map(p => ({ ...p.body.position })), positions);
  restored.resume();
  assert.equal(restored.drop(), false, 'cooldown cannot be bypassed by reopening');
  restored.step(GAME.dropCooldown);
  assert.ok(restored.drop());
  assert.equal(Matter.Composite.allBodies(restored.engine.world).length, restored.pieces.size + 3);
  game.destroy(); restored.destroy();
});

test('airborne entry exemption survives closing and reopening', () => {
  const game = new PhysicsGame(() => {}, () => 0);
  game.drop();
  game.step(100);
  const saved = game.save()!;
  assert.equal(saved.pieces[0].overflowEligible, false);
  const restored = new PhysicsGame();
  restored.restore(saved);
  restored.resume();
  restored.step(5000);
  assert.equal(restored.snapshot().status, 'playing');
  assert.equal([...restored.pieces.values()][0].overflowEligible, true);
  game.destroy(); restored.destroy();
});

test('a previously landed circle cannot gain entry exemption by restoring', () => {
  const game = new PhysicsGame();
  const piece = game.spawn(0, 220, 200);
  Matter.Body.setPosition(piece.body, { x: 220, y: GAME.deadline - LEVELS[0].radius - 10 });
  const restored = new PhysicsGame();
  assert.ok(restored.restore(game.save()));
  restored.resume(); restored.step(1000 / 60);
  assert.equal(restored.snapshot().status, 'gameover');
  assert.equal(restored.save(), null, 'finished rounds cannot be resumed');
  game.destroy(); restored.destroy();
});

test('restoring a crown is silent and does not fire it again', () => {
  const game = new PhysicsGame();
  game.spawn(10, 220, 450);
  game.step(1000 / 60);
  const events: PhysicsEvent[] = [];
  const restored = new PhysicsGame(e => events.push(e));
  restored.restore(game.save());
  restored.resume(); restored.step(1000 / 60);
  assert.equal(events.length, 0);
  game.destroy(); restored.destroy();
});

test('malformed and incompatible saves leave the current world intact', () => {
  const game = new PhysicsGame();
  const piece = game.spawn(0, 220, 450);
  const valid = game.save()!;
  for (const bad of [null, {}, { ...valid, version: 2 }, { ...valid, score: NaN },
    { ...valid, currentLevel: 10 }, { ...valid, pieces: [{ ...valid.pieces[0], level: 99 }] },
    { ...valid, pieces: [{ ...valid.pieces[0], x: Infinity }] },
    { ...valid, pieces: [{ ...valid.pieces[0], overflowEligible: 'false' }] }]) {
    assert.equal(game.restore(bad), false);
    assert.equal(game.pieces.get(piece.body.id), piece);
  }
  game.reset();
  assert.equal(game.save(), null);
  game.destroy();
});

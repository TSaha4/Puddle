import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { blobProfile, blobRadius, NO_POKE } from '../src/visuals/blobMath';

test('ambient is teal, calmer and slower than the future game preset', () => {
  const calm = blobProfile('ambient-audio');
  const game = blobProfile('breathing-game');
  assert.equal(calm.color, '#7FD1C4');
  assert.ok(calm.amplitude < game.amplitude);
  assert.ok(calm.speed < game.speed);
  assert.equal(blobProfile().color, '#FF6B4A');
});

test('tempo is bounded and invalid tempo falls back to a finite pace', () => {
  assert.equal(blobProfile('ambient-audio', 1).speed, blobProfile('ambient-audio', 30).speed);
  assert.equal(blobProfile('ambient-audio', 1000).speed, blobProfile('ambient-audio', 120).speed);
  assert.equal(blobProfile('ambient-audio', NaN).speed, blobProfile('ambient-audio', 60).speed);
});

test('a poke dents the touched side rather than uniformly deforming the blob', () => {
  const profile = blobProfile('ambient-audio');
  const poke = { x: 0, y: 0, z: 1, strength: 0.27 };
  const front = blobRadius(0, 0, 1, 0, profile, NO_POKE) - blobRadius(0, 0, 1, 0, profile, poke);
  const back = blobRadius(0, 0, -1, 0, profile, NO_POKE) - blobRadius(0, 0, -1, 0, profile, poke);
  assert.ok(front > 0.26);
  assert.ok(back < 0.0001);
});

test('reduced-motion profile produces an organic but time-invariant radius', () => {
  const still = { ...blobProfile('ambient-audio'), amplitude: 0 };
  assert.equal(blobRadius(0, 0, 1, 0, still, NO_POKE), blobRadius(0, 0, 1, 100, still, NO_POKE));
  assert.notEqual(blobRadius(1, 0, 0, 0, still, NO_POKE), blobRadius(0, 1, 0, 0, still, NO_POKE));
});

test('all presets remain finite and positive under maximum poking over time', () => {
  for (const type of [undefined, 'ambient-audio', 'breathing-game', 'blob-visual', 'rant-doodle']) {
    for (let step = 0; step < 100; step++) {
      const angle = step * 0.1;
      const radius = blobRadius(Math.cos(angle), Math.sin(angle), 0, step, blobProfile(type), { x: 1, y: 0, z: 0, strength: 99 });
      assert.ok(Number.isFinite(radius) && radius > 0.45 && radius < 1.3);
    }
  }
});

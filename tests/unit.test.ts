import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intersect, planOutput, visibleRows } from '../src/geometry';
test('intersection excludes outside viewport and ancestor clip', () => {
  assert.deepEqual(intersect({ left: 0, top: 0, right: 1000, bottom: 800 }, { left: 100, top: 60, right: 900, bottom: 760 }), { left: 100, top: 60, right: 900, bottom: 760 });
});
test('short output fits one canvas; tall output splits without unsafe allocation', () => {
  assert.equal(planOutput(1600, 6005).count, 1);
  assert.equal(planOutput(1600, 20000).count, 3);
  assert.throws(() => planOutput(20000, 100));
  assert.throws(() => planOutput(1600, 200000));
  assert.throws(() => planOutput(NaN, 100));
});
test('shared rounding endpoints cover each row once at fractional DPI', () => {
  const total = 4001;
  const first = visibleRows({ left: 0, right: 700, top: 24.4, bottom: 3225.2 }, { left: 0, right: 1000, top: 0, bottom: 800 }, 1.25, 0, total);
  assert.equal(first.sourceY, 31);
  assert.equal(first.rows, 969);
  const second = visibleRows({ left: 0, right: 700, top: -730.8, bottom: 2470 }, { left: 0, right: 1000, top: 0, bottom: 800 }, 1.25, 969, total);
  // Math.round(-913.5) is -913 (ties toward +Infinity).
  assert.equal(second.rows, 944);
  assert.equal(second.sourceY, 56);
});
test('bottom clamping consumes only unseen rows and stops at exact target end', () => {
  const rows = visibleRows({ left: 100, right: 800, top: -1200, bottom: 700 }, { left: 0, right: 1000, top: 50, bottom: 800 }, 2, 3000, 3800);
  assert.deepEqual(rows, { sourceY: 600, rows: 800 });
});
test('gap or zero progress fails explicitly rather than silently dropping text', () => {
  assert.throws(() => visibleRows({ left: 0, right: 700, top: -100, bottom: 1000 }, { left: 0, right: 1000, top: 50, bottom: 800 }, 1, 0, 1100), /空缺/);
  assert.throws(() => visibleRows({ left: 0, right: 700, top: 100, bottom: 2000 }, { left: 0, right: 1000, top: 0, bottom: 800 }, 1, 700, 1900), /滚动/);
});

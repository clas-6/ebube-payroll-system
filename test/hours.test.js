'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { extractHoursMap, toHours } = require('../src/utils/hours');

describe('extractHoursMap', () => {
  test('maps flat hours_<id> fields to employee ids', () => {
    const map = extractHoursMap({ hours_1: '40', hours_2: '30', hours_12: '8.5' });
    assert.deepEqual(map, { 1: '40', 2: '30', 12: '8.5' });
  });

  test('does NOT collapse ids into a shifted array (the original bug)', () => {
    const map = extractHoursMap({ hours_1: '40', hours_2: '40', hours_3: 'abc' });
    assert.equal(Array.isArray(map), false);
    assert.equal(map[2], '40');
    assert.equal(map[3], 'abc');
  });

  test('ignores an array-shaped hours value (fail-safe)', () => {
    const map = extractHoursMap({ hours: ['40', '40', 'abc'] });
    assert.deepEqual(map, {});
  });

  test('reads an object-shaped hours value when flat keys are absent', () => {
    const map = extractHoursMap({ hours: { 1: '40', 2: '12' } });
    assert.deepEqual(map, { 1: '40', 2: '12' });
  });

  test('flat keys win over object-shaped duplicates', () => {
    const map = extractHoursMap({ hours_1: '40', hours: { 1: '99' } });
    assert.equal(map[1], '40');
  });

  test('returns an empty map for missing or malformed bodies', () => {
    assert.deepEqual(extractHoursMap(undefined), {});
    assert.deepEqual(extractHoursMap(null), {});
    assert.deepEqual(extractHoursMap('hours_1=40'), {});
    assert.deepEqual(extractHoursMap({ name: 'no hours here' }), {});
  });

  test('ignores non-numeric hours keys', () => {
    const map = extractHoursMap({ hours_abc: '40', hours_: '1' });
    assert.deepEqual(map, {});
  });
});

describe('toHours', () => {
  test('parses valid numbers', () => {
    assert.equal(toHours('40'), 40);
    assert.equal(toHours(' 40 '), 40);
    assert.equal(toHours('0.5'), 0.5);
    assert.equal(toHours(40), 40);
  });

  test('returns undefined for missing values', () => {
    assert.equal(toHours(undefined), undefined);
    assert.equal(toHours(null), undefined);
    assert.equal(toHours(''), undefined);
    assert.equal(toHours('   '), undefined);
  });

  test('returns NaN for unparseable values so the service rejects them', () => {
    assert.ok(Number.isNaN(toHours('abc')));
    assert.ok(Number.isNaN(toHours('12abc')));
  });
});

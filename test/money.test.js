'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { dollarsToCents, formatCents } = require('../src/utils/money');

describe('dollarsToCents', () => {
  test('parses whole dollars', () => {
    assert.equal(dollarsToCents('50000'), 5_000_000);
    assert.equal(dollarsToCents('20'), 2_000);
    assert.equal(dollarsToCents('0'), 0);
  });

  test('parses one and two decimals', () => {
    assert.equal(dollarsToCents('20.5'), 2_050);
    assert.equal(dollarsToCents('0.75'), 75);
    assert.equal(dollarsToCents('1.00'), 100);
  });

  test('accepts numeric input and surrounding whitespace', () => {
    assert.equal(dollarsToCents('  12.34  '), 1_234);
    assert.equal(dollarsToCents(12.34), 1_234);
  });

  test('preserves sign for negatives (validation rejects them later)', () => {
    assert.equal(dollarsToCents('-5'), -500);
  });

  test('rejects empty and non-numeric values', () => {
    assert.throws(() => dollarsToCents(''), RangeError);
    assert.throws(() => dollarsToCents('abc'), RangeError);
    assert.throws(() => dollarsToCents('NaN'), RangeError);
    assert.throws(() => dollarsToCents('Infinity'), RangeError);
  });

  test('rejects more than two decimal places', () => {
    assert.throws(() => dollarsToCents('1.234'), RangeError);
    assert.throws(() => dollarsToCents('1.'), RangeError);
    assert.throws(() => dollarsToCents('.5'), RangeError);
  });

  test('rejects values outside the safe integer range', () => {
    assert.throws(() => dollarsToCents('99999999999999999'), RangeError);
  });
});

describe('formatCents', () => {
  test('formats with exactly two decimals', () => {
    assert.equal(formatCents(0), '0.00');
    assert.equal(formatCents(5), '0.05');
    assert.equal(formatCents(50), '0.50');
    assert.equal(formatCents(100), '1.00');
  });

  test('adds thousands separators', () => {
    assert.equal(formatCents(192_308), '1,923.08');
    assert.equal(formatCents(5_000_000), '50,000.00');
    assert.equal(formatCents(1_234_567_89), '1,234,567.89');
  });

  test('handles negatives', () => {
    assert.equal(formatCents(-105), '-1.05');
  });

  test('rejects non-integers and unsafe values', () => {
    assert.throws(() => formatCents(1.5), RangeError);
    assert.throws(() => formatCents(NaN), RangeError);
    assert.throws(() => formatCents('100'), RangeError);
  });

  test('round-trips with dollarsToCents', () => {
    for (const s of ['0', '1', '12.34', '50000', '0.05']) {
      assert.equal(formatCents(dollarsToCents(s)), s.includes('.') ? s : `${Number(s).toLocaleString('en-US')}.00`);
    }
  });
});

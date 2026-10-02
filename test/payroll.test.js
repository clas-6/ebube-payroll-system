'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  calculatePaycheck,
  PayrollInputError,
  DEFAULT_TAX_RATE,
  SALARY_PERIODS_PER_YEAR,
} = require('../src/services/payroll');

describe('calculatePaycheck - normal cases', () => {
  test('salaried employee: annual rate is split across 26 periods', () => {
    // $50,000 / 26 = $1,923.0769... -> $1,923.08
    const r = calculatePaycheck({ payType: 'salary', rateCents: 5_000_000 });
    assert.equal(r.grossCents, 192_308);
    assert.equal(r.taxCents, 28_846); // 15% of 192,308 = 28,846.2 -> 28,846
    assert.equal(r.netCents, 163_462);
  });

  test('hourly employee: rate x hours', () => {
    // $20/hr x 40h = $800.00
    const r = calculatePaycheck({ payType: 'hourly', rateCents: 2_000, hours: 40 });
    assert.equal(r.grossCents, 80_000);
    assert.equal(r.taxCents, 12_000);
    assert.equal(r.netCents, 68_000);
  });

  test('salary that divides evenly', () => {
    // $52,000 / 26 = exactly $2,000.00
    const r = calculatePaycheck({ payType: 'salary', rateCents: 5_200_000 });
    assert.equal(r.grossCents, 200_000);
    assert.equal(r.taxCents, 30_000);
    assert.equal(r.netCents, 170_000);
  });

  test('salary that does not divide evenly rounds to nearest cent', () => {
    // $45,000 / 26 = 173,076.923 cents -> 173,077
    const r = calculatePaycheck({ payType: 'salary', rateCents: 4_500_000 });
    assert.equal(r.grossCents, 173_077);
    assert.equal(r.taxCents, 25_962); // 25,961.55 -> 25,962
    assert.equal(r.netCents, 147_115);
  });

  test('tax rate is configurable, defaulting to 15%', () => {
    assert.equal(DEFAULT_TAX_RATE, 0.15);
    const r = calculatePaycheck({
      payType: 'hourly',
      rateCents: 10_000,
      hours: 10,
      taxRate: 0.2,
    });
    assert.equal(r.grossCents, 100_000);
    assert.equal(r.taxCents, 20_000);
    assert.equal(r.netCents, 80_000);
  });

  test('exposes the bi-weekly assumption as a named constant', () => {
    assert.equal(SALARY_PERIODS_PER_YEAR, 26);
  });
});

describe('calculatePaycheck - invariants', () => {
  const cases = [
    { payType: 'salary', rateCents: 5_000_000 },
    { payType: 'salary', rateCents: 4_500_000 },
    { payType: 'salary', rateCents: 1 },
    { payType: 'hourly', rateCents: 2_000, hours: 40 },
    { payType: 'hourly', rateCents: 1_777, hours: 33.33 },
    { payType: 'hourly', rateCents: 99, hours: 0.5 },
  ];

  for (const c of cases) {
    test(`gross - tax === net for ${JSON.stringify(c)}`, () => {
      const r = calculatePaycheck(c);
      assert.equal(r.grossCents - r.taxCents, r.netCents);
    });

    test(`all returned values are integers for ${JSON.stringify(c)}`, () => {
      const r = calculatePaycheck(c);
      assert.ok(Number.isInteger(r.grossCents), 'grossCents must be an integer');
      assert.ok(Number.isInteger(r.taxCents), 'taxCents must be an integer');
      assert.ok(Number.isInteger(r.netCents), 'netCents must be an integer');
    });
  }

  test('tax is never negative', () => {
    const r = calculatePaycheck({ payType: 'salary', rateCents: 1 });
    assert.ok(r.taxCents >= 0);
  });
});

describe('calculatePaycheck - zero and edge inputs', () => {
  test('hourly with zero hours pays nothing', () => {
    const r = calculatePaycheck({ payType: 'hourly', rateCents: 2_000, hours: 0 });
    assert.deepEqual(r, { grossCents: 0, taxCents: 0, netCents: 0 });
  });

  test('zero rate pays nothing', () => {
    const r = calculatePaycheck({ payType: 'salary', rateCents: 0 });
    assert.deepEqual(r, { grossCents: 0, taxCents: 0, netCents: 0 });
  });

  test('half an hour of work is supported', () => {
    const r = calculatePaycheck({ payType: 'hourly', rateCents: 2_000, hours: 0.5 });
    assert.equal(r.grossCents, 1_000);
    assert.equal(r.taxCents, 150);
    assert.equal(r.netCents, 850);
  });
});

describe('calculatePaycheck - invalid inputs must throw PayrollInputError', () => {
  const invalidCases = [
    ['negative rate', { payType: 'salary', rateCents: -1 }],
    ['negative hours', { payType: 'hourly', rateCents: 2_000, hours: -1 }],
    ['NaN rate', { payType: 'salary', rateCents: NaN }],
    ['NaN hours', { payType: 'hourly', rateCents: 2_000, hours: NaN }],
    ['Infinity rate', { payType: 'salary', rateCents: Infinity }],
    ['Infinity hours', { payType: 'hourly', rateCents: 2_000, hours: Infinity }],
    ['unknown pay type', { payType: 'monthly', rateCents: 100 }],
    ['missing pay type', { payType: undefined, rateCents: 100 }],
    ['hourly without hours', { payType: 'hourly', rateCents: 2_000 }],
    [
      'value beyond safe integer range',
      { payType: 'hourly', rateCents: 1e16, hours: 40 },
    ],
  ];

  for (const [label, input] of invalidCases) {
    test(`${label} is rejected`, () => {
      assert.throws(() => calculatePaycheck(input), PayrollInputError);
    });
  }
});

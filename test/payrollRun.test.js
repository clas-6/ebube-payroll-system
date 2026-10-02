'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { openTestDb, run, all, close } = require('./helpers/testDb');
const {
  finalizePayrollRun,
  listPeriods,
  listStubsForPeriod,
} = require('../src/services/payrollRun');

let db;

beforeEach(async () => {
  db = await openTestDb();
  await run(db, 'INSERT INTO employees (name, pay_type, rate_cents) VALUES (?, ?, ?)', [
    'Demo Alice',
    'salary',
    5000000,
  ]);
  await run(db, 'INSERT INTO employees (name, pay_type, rate_cents) VALUES (?, ?, ?)', [
    'Demo Bob',
    'hourly',
    2000,
  ]);
});

afterEach(async () => {
  await close(db);
});

const EMPLOYEES = [
  { id: 1, name: 'Demo Alice', pay_type: 'salary', rate_cents: 5000000 },
  { id: 2, name: 'Demo Bob', pay_type: 'hourly', rate_cents: 2000 },
];

describe('finalizePayrollRun', () => {
  test('saves a period with correct totals', async () => {
    const { periodId, totals } = await finalizePayrollRun(db, {
      label: '2026-01-01 to 2026-01-14',
      employees: EMPLOYEES,
      hoursMap: { 2: 40 },
    });
    assert.ok(periodId);

    const periods = await listPeriods(db);
    assert.equal(periods.length, 1);
    assert.equal(periods[0].label, '2026-01-01 to 2026-01-14');
    assert.equal(periods[0].pay_frequency, 'bi-weekly');
    assert.equal(periods[0].tax_rate, 0.15);
    assert.equal(periods[0].employee_count, 2);
    // Alice 1,923.08 + Bob 800.00
    assert.equal(totals.grossCents, 192308 + 80000);
    assert.equal(periods[0].total_gross_cents, 272308);
    assert.ok(periods[0].finalized_at);
  });

  test('saves one stub per employee with gross, tax, net and rate', async () => {
    const { periodId } = await finalizePayrollRun(db, {
      label: 'Run 1',
      employees: EMPLOYEES,
      hoursMap: { 2: 40 },
    });
    const stubs = await listStubsForPeriod(db, periodId);
    assert.equal(stubs.length, 2);

    const alice = stubs.find((s) => s.employee_id === 1);
    const bob = stubs.find((s) => s.employee_id === 2);
    assert.equal(alice.gross_cents, 192308);
    assert.equal(alice.tax_cents, 28846);
    assert.equal(alice.net_cents, 163462);
    assert.equal(alice.tax_rate, 0.15);
    assert.equal(alice.hours, null);
    assert.ok(alice.created_at);

    assert.equal(bob.gross_cents, 80000);
    assert.equal(bob.hours, 40);
  });

  test('totals are the sum of stub net amounts', async () => {
    const { periodId, totals } = await finalizePayrollRun(db, {
      label: 'Run 2',
      employees: EMPLOYEES,
      hoursMap: { 2: 40 },
    });
    const stubs = await listStubsForPeriod(db, periodId);
    const sumNet = stubs.reduce((a, s) => a + s.net_cents, 0);
    assert.equal(totals.netCents, sumNet);
    assert.equal(totals.grossCents - totals.taxCents, totals.netCents);
  });

  test('accepts a custom tax rate', async () => {
    const { periodId } = await finalizePayrollRun(db, {
      label: 'Run 3',
      taxRate: 0.2,
      employees: EMPLOYEES,
      hoursMap: { 2: 40 },
    });
    const stubs = await listStubsForPeriod(db, periodId);
    const bob = stubs.find((s) => s.employee_id === 2);
    assert.equal(bob.gross_cents, 80000);
    assert.equal(bob.tax_cents, 16000);
    assert.equal(bob.tax_rate, 0.2);
  });

  test('rejects a run with no label', async () => {
    await assert.rejects(
      finalizePayrollRun(db, { label: '', employees: EMPLOYEES, hoursMap: { 2: 40 } }),
      /label/i
    );
  });

  test('rejects a run when an hourly employee is missing hours', async () => {
    await assert.rejects(
      finalizePayrollRun(db, { label: 'Run 4', employees: EMPLOYEES, hoursMap: {} }),
      /hours/i
    );
    // Nothing was persisted (transaction rolled back).
    const periods = await listPeriods(db);
    assert.equal(periods.length, 0);
  });

  test('rejects a duplicate period label and persists nothing', async () => {
    await finalizePayrollRun(db, {
      label: 'Dup',
      employees: EMPLOYEES,
      hoursMap: { 2: 40 },
    });
    await assert.rejects(
      finalizePayrollRun(db, { label: 'Dup', employees: EMPLOYEES, hoursMap: { 2: 40 } }),
      /UNIQUE constraint/i
    );
    const periods = await listPeriods(db);
    assert.equal(periods.length, 1, 'only the first run should exist');
    const stubs = await all(db, 'SELECT * FROM pay_stubs');
    assert.equal(stubs.length, 2, 'no orphan stubs from the failed run');
  });
});

describe('saved runs are immutable', () => {
  test('a saved stub cannot be edited or removed', async () => {
    const { periodId } = await finalizePayrollRun(db, {
      label: 'Immutable',
      employees: EMPLOYEES,
      hoursMap: { 2: 40 },
    });
    await assert.rejects(
      run(db, 'UPDATE pay_stubs SET net_cents = 999999'),
      /immutable/i
    );
    await assert.rejects(run(db, 'DELETE FROM pay_stubs'), /immutable/i);
    await assert.rejects(
      run(db, 'UPDATE pay_periods SET tax_rate = 0'),
      /immutable/i
    );

    const stubs = await listStubsForPeriod(db, periodId);
    assert.equal(stubs.length, 2);
    assert.equal(stubs[0].net_cents, 163462);
  });
});

describe('history reads', () => {
  test('lists periods newest first', async () => {
    await finalizePayrollRun(db, { label: 'First', employees: EMPLOYEES, hoursMap: { 2: 40 } });
    await finalizePayrollRun(db, { label: 'Second', employees: EMPLOYEES, hoursMap: { 2: 40 } });
    const periods = await listPeriods(db);
    assert.deepEqual(
      periods.map((p) => p.label),
      ['Second', 'First']
    );
  });
});

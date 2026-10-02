'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { openTestDb, run, all, close } = require('./helpers/testDb');

let db;

before(async () => {
  db = await openTestDb();
});

after(async () => {
  await close(db);
});

describe('schema', () => {
  test('creates the expected tables and indexes', async () => {
    const rows = await all(
      db,
      "SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index') ORDER BY name"
    );
    const names = rows.map((r) => r.name);
    for (const expected of [
      'employees',
      'pay_periods',
      'pay_stubs',
      'pay_stubs_immutable_update',
      'pay_stubs_immutable_delete',
      'pay_periods_immutable_update',
      'pay_periods_immutable_delete',
      'audit_log_immutable_update',
      'audit_log_immutable_delete',
      'users',
      'audit_log',
      'idx_pay_stubs_period',
      'idx_pay_stubs_employee',
    ]) {
      assert.ok(names.includes(expected), `missing ${expected}`);
    }
  });

  test('rejects an invalid pay_type at the database level', async () => {
    await assert.rejects(
      run(db, 'INSERT INTO employees (name, pay_type, rate_cents) VALUES (?, ?, ?)', [
        'Bad',
        'weekly',
        100,
      ]),
      /CHECK constraint/i
    );
  });

  test('rejects a negative rate at the database level', async () => {
    await assert.rejects(
      run(db, 'INSERT INTO employees (name, pay_type, rate_cents) VALUES (?, ?, ?)', [
        'Bad',
        'hourly',
        -1,
      ]),
      /CHECK constraint/i
    );
  });

  test('rejects a NULL name at the database level', async () => {
    await assert.rejects(
      run(db, 'INSERT INTO employees (name, pay_type, rate_cents) VALUES (?, ?, ?)', [
        null,
        'hourly',
        100,
      ]),
      /NOT NULL constraint/i
    );
  });
});

describe('pay period + stub persistence', () => {
  let periodId;
  let employeeId;

  test('an employee exists to attach stubs to', async () => {
    const { lastID } = await run(
      db,
      'INSERT INTO employees (name, pay_type, rate_cents) VALUES (?, ?, ?)',
      ['Demo Alice', 'salary', 5000000]
    );
    employeeId = lastID;
    assert.ok(employeeId);
  });

  test('a finalized period is saved with totals and a timestamp', async () => {
    const { lastID } = await run(
      db,
      `INSERT INTO pay_periods (label, pay_frequency, tax_rate, employee_count,
            total_gross_cents, total_tax_cents, total_net_cents, finalized_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      ['2026-01-01 to 2026-01-14', 'bi-weekly', 0.15, 2, 272308, 40846, 231462]
    );
    periodId = lastID;
    const rows = await all(db, 'SELECT * FROM pay_periods WHERE id = ?', [periodId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tax_rate, 0.15);
    assert.equal(rows[0].total_net_cents, 231462);
    assert.ok(rows[0].finalized_at, 'finalized_at must be set');
  });

  test('saving a duplicate period for the same label is rejected', async () => {
    await assert.rejects(
      run(
        db,
        `INSERT INTO pay_periods (label, pay_frequency, tax_rate, employee_count,
            total_gross_cents, total_tax_cents, total_net_cents, finalized_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        ['2026-01-01 to 2026-01-14', 'bi-weekly', 0.15, 2, 272308, 40846, 231462]
      ),
      /UNIQUE constraint/i
    );
  });

  test('a stub is saved with gross, tax, net, tax rate and timestamp', async () => {
    const { lastID } = await run(
      db,
      `INSERT INTO pay_stubs (period_id, employee_id, employee_name, pay_type,
            rate_cents, hours, gross_cents, tax_cents, net_cents, tax_rate, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [periodId, employeeId, 'Demo Alice', 'salary', 5000000, null, 192308, 28846, 163462, 0.15]
    );
    const rows = await all(db, 'SELECT * FROM pay_stubs WHERE id = ?', [lastID]);
    assert.equal(rows[0].gross_cents, 192308);
    assert.equal(rows[0].tax_cents, 28846);
    assert.equal(rows[0].net_cents, 163462);
    assert.equal(rows[0].tax_rate, 0.15);
    assert.ok(rows[0].created_at);
  });

  test('the same employee cannot appear twice in one period', async () => {
    await assert.rejects(
      run(
        db,
        `INSERT INTO pay_stubs (period_id, employee_id, employee_name, pay_type,
            rate_cents, hours, gross_cents, tax_cents, net_cents, tax_rate, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [periodId, employeeId, 'Demo Alice', 'salary', 5000000, null, 192308, 28846, 163462, 0.15]
      ),
      /UNIQUE constraint/i
    );
  });

  test('a stub cannot reference a non-existent employee', async () => {
    await assert.rejects(
      run(
        db,
        `INSERT INTO pay_stubs (period_id, employee_id, employee_name, pay_type,
            rate_cents, hours, gross_cents, tax_cents, net_cents, tax_rate, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [periodId, 999999, 'Ghost', 'salary', 5000000, null, 192308, 28846, 163462, 0.15]
      ),
      /FOREIGN KEY constraint/i
    );
  });
});

describe('immutability of finalized payroll records', () => {
  test('a pay stub cannot be UPDATED', async () => {
    await assert.rejects(
      run(db, 'UPDATE pay_stubs SET net_cents = 1'),
      /immutable/i
    );
  });

  test('a pay stub cannot be DELETED', async () => {
    await assert.rejects(run(db, 'DELETE FROM pay_stubs'), /immutable/i);
  });

  test('a pay period cannot be UPDATED', async () => {
    await assert.rejects(
      run(db, 'UPDATE pay_periods SET tax_rate = 0'),
      /immutable/i
    );
  });

  test('a pay period cannot be DELETED', async () => {
    await assert.rejects(run(db, 'DELETE FROM pay_periods'), /immutable/i);
  });

  test('rows are still present after the rejected mutations', async () => {
    const periods = await all(db, 'SELECT COUNT(*) AS n FROM pay_periods');
    const stubs = await all(db, 'SELECT COUNT(*) AS n FROM pay_stubs');
    assert.equal(periods[0].n, 1);
    assert.equal(stubs[0].n, 1);
  });
});

describe('immutability of the audit log', () => {
  test('an audit entry can be appended', async () => {
    const { lastID } = await run(
      db,
      `INSERT INTO audit_log (actor, action, entity, entity_id, detail)
       VALUES (?, ?, ?, ?, ?)`,
      ['admin', 'create', 'employee', '1', 'Demo Alice (salary)']
    );
    assert.ok(lastID);
  });

  test('an audit entry cannot be UPDATED', async () => {
    await assert.rejects(
      run(db, "UPDATE audit_log SET actor = 'someone-else'"),
      /immutable/i
    );
  });

  test('an audit entry cannot be DELETED', async () => {
    await assert.rejects(run(db, 'DELETE FROM audit_log'), /immutable/i);
  });

  test('the appended entry survives the rejected mutations', async () => {
    const rows = await all(db, 'SELECT actor, action FROM audit_log');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor, 'admin');
    assert.equal(rows[0].action, 'create');
  });
});

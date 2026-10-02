'use strict';

/**
 * Schema definition for the payroll prototype.
 *
 * Kept separate from `database.js` so it can be applied to an in-memory
 * database and tested in isolation.
 *
 * MONEY: all *_cents columns are INTEGER minor units.
 *
 * IMMUTABILITY: once a payroll run is written, its pay stubs can never be
 * updated or deleted. This is enforced by SQLite triggers, not by
 * application code, so it holds even if a bug (or a future route) tries.
 */

const EMPLOYEES_DDL = `
CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    pay_type TEXT NOT NULL CHECK (pay_type IN ('hourly', 'salary')),
    rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (rate_cents >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const PAY_PERIODS_DDL = `
CREATE TABLE IF NOT EXISTS pay_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    pay_frequency TEXT NOT NULL DEFAULT 'bi-weekly'
        CHECK (pay_frequency IN ('weekly', 'bi-weekly', 'monthly')),
    tax_rate REAL NOT NULL CHECK (tax_rate >= 0 AND tax_rate <= 1),
    employee_count INTEGER NOT NULL DEFAULT 0,
    total_gross_cents INTEGER NOT NULL DEFAULT 0,
    total_tax_cents INTEGER NOT NULL DEFAULT 0,
    total_net_cents INTEGER NOT NULL DEFAULT 0,
    finalized_at TEXT NOT NULL,
    UNIQUE (label, pay_frequency)
)`;

const PAY_STUBS_DDL = `
CREATE TABLE IF NOT EXISTS pay_stubs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id INTEGER NOT NULL REFERENCES pay_periods(id),
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    employee_name TEXT NOT NULL,
    pay_type TEXT NOT NULL,
    rate_cents INTEGER NOT NULL,
    hours REAL,
    gross_cents INTEGER NOT NULL,
    tax_cents INTEGER NOT NULL,
    net_cents INTEGER NOT NULL,
    tax_rate REAL NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (period_id, employee_id)
)`;

// Deny ALL mutation of finalized records. Defined inline in STATEMENTS below
// because each SQL string must contain exactly one statement.

// NOTE: each entry must be a SINGLE statement. node-sqlite3's `db.run`
// executes only the first statement in a string, so multi-statement blocks
// would be silently truncated.
const STATEMENTS = [
  EMPLOYEES_DDL,
  PAY_PERIODS_DDL,
  PAY_STUBS_DDL,
  `CREATE TRIGGER IF NOT EXISTS pay_stubs_immutable_update
   BEFORE UPDATE ON pay_stubs
   BEGIN
       SELECT RAISE(ABORT, 'Pay stubs are immutable once finalized');
   END`,
  `CREATE TRIGGER IF NOT EXISTS pay_stubs_immutable_delete
   BEFORE DELETE ON pay_stubs
   BEGIN
       SELECT RAISE(ABORT, 'Pay stubs are immutable once finalized');
   END`,
  `CREATE TRIGGER IF NOT EXISTS pay_periods_immutable_update
   BEFORE UPDATE ON pay_periods
   BEGIN
       SELECT RAISE(ABORT, 'Pay periods are immutable once finalized');
   END`,
  `CREATE TRIGGER IF NOT EXISTS pay_periods_immutable_delete
   BEFORE DELETE ON pay_periods
   BEGIN
       SELECT RAISE(ABORT, 'Pay periods are immutable once finalized');
   END`,
  `CREATE INDEX IF NOT EXISTS idx_pay_stubs_period ON pay_stubs(period_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pay_stubs_employee ON pay_stubs(employee_id)`,
];

/** Apply the full schema to a sqlite3 database. Returns a Promise. */
function createSchema(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      let failed = null;
      for (const sql of STATEMENTS) {
        db.run(sql, (err) => {
          if (err && !failed) failed = err;
        });
      }
      db.run('SELECT 1', (err) => {
        if (failed) reject(failed);
        else if (err) reject(err);
        else resolve();
      });
    });
  });
}

module.exports = {
  createSchema,
  STATEMENTS,
  EMPLOYEES_DDL,
  PAY_PERIODS_DDL,
  PAY_STUBS_DDL,
};

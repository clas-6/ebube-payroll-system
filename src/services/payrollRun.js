'use strict';

/**
 * Payroll run persistence.
 *
 * A "run" = one finalized pay period + one pay stub per employee.
 * Writes happen inside a transaction so a run is either fully saved or not
 * saved at all. Once written, the DB triggers make the rows immutable.
 */

const { calculatePaycheck, DEFAULT_TAX_RATE } = require('./payroll');
const { withWriteLock } = require('../db/writeLock');

const INSERT_PERIOD = `
INSERT INTO pay_periods (label, pay_frequency, tax_rate, employee_count,
        total_gross_cents, total_tax_cents, total_net_cents, finalized_at)
VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`;

const INSERT_STUB = `
INSERT INTO pay_stubs (period_id, employee_id, employee_name, pay_type,
        rate_cents, hours, gross_cents, tax_cents, net_cents, tax_rate, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`;

/**
 * Finalize a payroll run: compute every employee's pay and persist the period
 * plus all stubs atomically.
 *
 * @param {object} db sqlite3 database handle
 * @param {object} opts
 * @param {string} opts.label display label for the period (e.g. date range)
 * @param {string} [opts.payFrequency='bi-weekly']
 * @param {number} [opts.taxRate] defaults to the service default (0.15)
 * @param {Array<object>} opts.employees rows with id, name, pay_type, rate_cents
 * @param {Record<string,number>} opts.hoursMap employee id -> hours
 * @returns {Promise<{periodId:number, stubs:Array<object>, totals:object}>}
 */
function finalizePayrollRun(db, { label, payFrequency = 'bi-weekly', taxRate, employees, hoursMap = {} }) {
  if (!label || typeof label !== 'string' || !label.trim()) {
    return Promise.reject(new Error('A period label is required'));
  }

  const effectiveTaxRate = taxRate === undefined ? DEFAULT_TAX_RATE : taxRate;

  // Computed inside try/catch so a calculation error surfaces as a REJECTED
  // PROMISE (not a synchronous throw) - callers use .catch / await.
  let stubs;
  let totals;
  try {
    stubs = employees.map((emp) => {
      const hours = emp.pay_type === 'hourly' ? hoursMap[emp.id] : undefined;
      const { grossCents, taxCents, netCents } = calculatePaycheck({
        payType: emp.pay_type,
        rateCents: emp.rate_cents,
        hours,
        taxRate: effectiveTaxRate,
      });
      return {
        employeeId: emp.id,
        employeeName: emp.name,
        payType: emp.pay_type,
        rateCents: emp.rate_cents,
        hours: emp.pay_type === 'hourly' ? hours : null,
        grossCents,
        taxCents,
        netCents,
        taxRate: effectiveTaxRate,
      };
    });

    totals = stubs.reduce(
      (acc, s) => ({
        grossCents: acc.grossCents + s.grossCents,
        taxCents: acc.taxCents + s.taxCents,
        netCents: acc.netCents + s.netCents,
      }),
      { grossCents: 0, taxCents: 0, netCents: 0 }
    );
  } catch (err) {
    return Promise.reject(err);
  }

  // The whole transaction runs under the write lock so that a concurrent write
  // cannot be queued between our BEGIN and COMMIT and get caught up in it.
  return withWriteLock(
    () =>
      new Promise((resolve, reject) => {
        // Statements are issued FROM WITHIN callbacks: sqlite3 queues
        // parameters at call time, so issuing them up-front would capture
        // `periodId` before it has been assigned (and would evaluate the
        // COMMIT/ROLLBACK choice before any error could be known).
        db.run('BEGIN TRANSACTION', (beginErr) => {
          if (beginErr) return reject(beginErr);

          db.run(
            INSERT_PERIOD,
            [
              label.trim(),
              payFrequency,
              effectiveTaxRate,
              stubs.length,
              totals.grossCents,
              totals.taxCents,
              totals.netCents,
            ],
            function onPeriod(err) {
              if (err) {
                return db.run('ROLLBACK', () => reject(err));
              }
              const periodId = this.lastID;

              let index = 0;
              const insertNext = () => {
                if (index >= stubs.length) {
                  return db.run('COMMIT', (txErr) => {
                    if (txErr) return db.run('ROLLBACK', () => reject(txErr));
                    resolve({ periodId, stubs, totals });
                  });
                }
                const s = stubs[index++];
                db.run(
                  INSERT_STUB,
                  [
                    periodId,
                    s.employeeId,
                    s.employeeName,
                    s.payType,
                    s.rateCents,
                    s.hours,
                    s.grossCents,
                    s.taxCents,
                    s.netCents,
                    s.taxRate,
                  ],
                  (stubErr) => {
                    if (stubErr) return db.run('ROLLBACK', () => reject(stubErr));
                    insertNext();
                  }
                );
              };
              insertNext();
            }
          );
        });
      })
  );
}

/** List all finalized periods, newest first. */
function listPeriods(db) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM pay_periods ORDER BY id DESC',
      [],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

/** List the stubs for one period. */
function listStubsForPeriod(db, periodId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM pay_stubs WHERE period_id = ? ORDER BY id',
      [periodId],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

/** Fetch a single period header. */
function getPeriod(db, periodId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM pay_periods WHERE id = ?', [periodId], (err, row) =>
      err ? reject(err) : resolve(row)
    );
  });
}

module.exports = { finalizePayrollRun, listPeriods, listStubsForPeriod, getPeriod };

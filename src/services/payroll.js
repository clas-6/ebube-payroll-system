'use strict';

/**
 * Payroll calculation service.
 *
 * All money is represented as INTEGER MINOR UNITS (cents) to avoid the
 * floating-point rounding errors inherent in IEEE-754 binary floats.
 * Formatting to a currency string happens only at display time.
 */

/** Flat demo tax rate. NOT legal advice - must be verified per jurisdiction. */
const DEFAULT_TAX_RATE = 0.15;

/** Number of pay periods per year for salaried staff (bi-weekly). */
const SALARY_PERIODS_PER_YEAR = 26;

/** Largest cent value we can safely do integer arithmetic on. */
const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

class PayrollInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PayrollInputError';
  }
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PayrollInputError(`${label} must be a finite number`);
  }
}

function assertNonNegative(value, label) {
  assertFiniteNumber(value, label);
  if (value < 0) {
    throw new PayrollInputError(`${label} must not be negative`);
  }
}

/** Round half away from zero (deterministic for money, unlike toFixed quirks). */
function roundHalfAwayFromZero(value) {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

function assertSafeCents(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new PayrollInputError(`${label} is outside the safe integer range`);
  }
}

/**
 * Gross pay in cents for one pay period.
 *
 * - 'salary': annual rate is split across SALARY_PERIODS_PER_YEAR periods.
 * - 'hourly': hourly rate multiplied by hours worked.
 */
function calculateGrossCents({ payType, rateCents, hours }) {
  if (payType !== 'salary' && payType !== 'hourly') {
    throw new PayrollInputError('payType must be either "salary" or "hourly"');
  }
  assertNonNegative(rateCents, 'rateCents');

  let gross;
  if (payType === 'salary') {
    gross = roundHalfAwayFromZero(rateCents / SALARY_PERIODS_PER_YEAR);
  } else {
    if (hours === undefined) {
      throw new PayrollInputError('hours is required for hourly employees');
    }
    assertNonNegative(hours, 'hours');
    gross = roundHalfAwayFromZero(rateCents * hours);
  }

  assertSafeCents(gross, 'gross pay');
  return gross;
}

/** Income tax in cents, rounded half away from zero. */
function calculateTaxCents(grossCents, taxRate = DEFAULT_TAX_RATE) {
  assertSafeCents(grossCents, 'grossCents');
  assertFiniteNumber(taxRate, 'taxRate');
  if (taxRate < 0 || taxRate > 1) {
    throw new PayrollInputError('taxRate must be between 0 and 1');
  }
  const tax = roundHalfAwayFromZero(grossCents * taxRate);
  assertSafeCents(tax, 'tax');
  return tax;
}

/**
 * Calculate one pay period for one employee.
 *
 * @returns {{ grossCents: number, taxCents: number, netCents: number }}
 *   All values are integer cents. grossCents - taxCents === netCents by
 *   construction, so displayed figures always add up.
 */
function calculatePaycheck({ payType, rateCents, hours, taxRate } = {}) {
  const grossCents = calculateGrossCents({ payType, rateCents, hours });
  const taxCents = calculateTaxCents(
    grossCents,
    taxRate === undefined ? DEFAULT_TAX_RATE : taxRate
  );
  const netCents = grossCents - taxCents;
  assertSafeCents(netCents, 'net pay');
  return { grossCents, taxCents, netCents };
}

module.exports = {
  calculatePaycheck,
  calculateGrossCents,
  calculateTaxCents,
  PayrollInputError,
  DEFAULT_TAX_RATE,
  SALARY_PERIODS_PER_YEAR,
};

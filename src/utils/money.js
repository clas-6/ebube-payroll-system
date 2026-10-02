'use strict';

/**
 * Money helpers.
 *
 * Storage and arithmetic use INTEGER MINOR UNITS (cents).
 * Conversion to a human string happens ONLY at display time.
 */

const DECIMAL_PATTERN = /^-?\d+(\.\d{1,2})?$/;

/**
 * Parse a user-entered dollar amount ("50000", "20.5", "0.75") into cents.
 *
 * Accepts at most 2 decimal places; rejects anything else so we never
 * silently truncate money.
 *
 * @param {string|number} input
 * @returns {number} non-fractional cents
 * @throws {RangeError} when the value is not a valid money amount
 */
function dollarsToCents(input) {
  const raw = String(input).trim();
  if (raw === '') {
    throw new RangeError('amount must not be empty');
  }
  if (!DECIMAL_PATTERN.test(raw)) {
    throw new RangeError(`"${raw}" is not a valid amount (use up to 2 decimals)`);
  }

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ''] = unsigned.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`"${raw}" is outside the safe integer range`);
  }
  return negative ? -cents : cents;
}

/**
 * Format integer cents as a decimal string with thousands separators.
 *
 * This is a DISPLAY-ONLY helper; never feed its output back into math.
 *
 * @param {number} cents
 * @returns {string} e.g. "1,923.08"
 */
function formatCents(cents) {
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents)) {
    throw new RangeError('cents must be a safe integer');
  }
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

module.exports = { dollarsToCents, formatCents };

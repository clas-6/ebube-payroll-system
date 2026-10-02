'use strict';

/**
 * Input validation for HTTP form payloads.
 *
 * Deliberately dependency-free so the prototype keeps its surface small.
 * Every function either returns a sanitised value or throws ValidationError
 * with a message that is safe to show a user.
 */

const { dollarsToCents } = require('./money');

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const MAX_NAME_LENGTH = 120;
const PAY_TYPES = ['hourly', 'salary'];

/** Reasonable upper bound for a single pay rate (in cents): 10,000,000.00 */
const MAX_RATE_CENTS = 1_000_000_000;

/**
 * Validate and normalise an employee form payload.
 *
 * @param {{name?: *, pay_type?: *, rate?: *}} body
 * @returns {{name: string, payType: string, rateCents: number}}
 * @throws {ValidationError}
 */
function validateEmployee(body) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body is missing');
  }

  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) {
    throw new ValidationError('Name is required');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`Name must be at most ${MAX_NAME_LENGTH} characters`);
  }

  const payType = String(body.pay_type ?? '').trim();
  if (!PAY_TYPES.includes(payType)) {
    throw new ValidationError(
      `Pay type must be one of: ${PAY_TYPES.join(', ')}`
    );
  }

  let rateCents;
  try {
    rateCents = dollarsToCents(body.rate);
  } catch (err) {
    throw new ValidationError('Rate must be a valid amount with up to 2 decimals');
  }
  if (rateCents < 0) {
    throw new ValidationError('Rate must not be negative');
  }
  if (rateCents > MAX_RATE_CENTS) {
    throw new ValidationError('Rate is unreasonably large');
  }

  return { name, payType, rateCents };
}

/**
 * Validate hours supplied for a payroll run.
 *
 * @param {*} value raw hours value
 * @returns {number} hours (>= 0)
 * @throws {ValidationError}
 */
function validateHours(value) {
  if (value === undefined) {
    throw new ValidationError('Hours are required');
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError('Hours must be a number');
  }
  if (value < 0) {
    throw new ValidationError('Hours must not be negative');
  }
  if (value > 1_000) {
    throw new ValidationError('Hours are unreasonably large');
  }
  return value;
}

module.exports = { validateEmployee, validateHours, ValidationError, PAY_TYPES, MAX_NAME_LENGTH };

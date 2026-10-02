'use strict';

/**
 * Helpers for reading "hours worked" from a submitted payroll form.
 *
 * WHY THIS EXISTS:
 * The old form used inputs named `hours[1]`, `hours[2]`, ... (employee ids).
 * Express's query parser (`qs`) collapses numeric-bracket keys into a
 * 0-indexed ARRAY, so `hours[1]` landed at index 1 and employee id 2 read the
 * value typed for employee id 3. Employees were paid using someone else's
 * hours, and the highest-id employee silently received 0.
 *
 * The form now uses FLAT keys (`hours_12`), which parse into a plain object
 * keyed by employee id.
 */

const FLAT_KEY = /^hours_(\d+)$/;

/**
 * Build an employee-id -> hours-input map from a request body.
 *
 * Returns string keys ("12" -> "40"). Missing entries mean "no value".
 *
 * NOTE: an `hours` value that arrives as an ARRAY (the legacy qs shape) is
 * deliberately IGNORED. We cannot reliably tell which employee each slot
 * belonged to, so failing safe to "no hours supplied" beats paying the wrong
 * person. Callers surface a validation error for hourly staff.
 *
 * @param {object} body parsed request body
 * @returns {Record<string, string>}
 */
function extractHoursMap(body) {
  const map = {};
  if (!body || typeof body !== 'object') {
    return map;
  }

  for (const [key, value] of Object.entries(body)) {
    const match = FLAT_KEY.exec(key);
    if (match) {
      map[match[1]] = value;
    }
  }

  const legacy = body.hours;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    for (const [key, value] of Object.entries(legacy)) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) {
        map[key] = value;
      }
    }
  }

  return map;
}

/**
 * Convert a raw form value to a number the payroll service understands.
 *
 * - undefined/null/empty -> undefined (means "not supplied")
 * - unparseable -> NaN (the payroll service rejects it explicitly)
 *
 * @param {*} value
 * @returns {number|undefined}
 */
function toHours(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const text = String(value).trim();
  if (text === '') {
    return undefined;
  }
  return Number(text);
}

module.exports = { extractHoursMap, toHours };

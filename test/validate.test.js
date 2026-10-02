'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { validateEmployee, validateHours, ValidationError } = require('../src/utils/validate');

describe('validateEmployee - valid input', () => {
  test('accepts and normalises a salaried employee', () => {
    const r = validateEmployee({ name: '  Ada   Lovelace ', pay_type: 'salary', rate: '50000' });
    assert.deepEqual(r, { name: 'Ada Lovelace', payType: 'salary', rateCents: 5_000_000 });
  });

  test('accepts an hourly employee with decimals', () => {
    const r = validateEmployee({ name: 'Bob', pay_type: 'hourly', rate: '20.5' });
    assert.deepEqual(r, { name: 'Bob', payType: 'hourly', rateCents: 2_050 });
  });

  test('accepts a zero rate (unpaid placement)', () => {
    const r = validateEmployee({ name: 'Intern', pay_type: 'hourly', rate: '0' });
    assert.equal(r.rateCents, 0);
  });
});

describe('validateEmployee - invalid input', () => {
  const cases = [
    ['missing body', undefined],
    ['empty name', { name: '   ', pay_type: 'salary', rate: '100' }],
    ['missing name', { pay_type: 'salary', rate: '100' }],
    ['name too long', { name: 'x'.repeat(121), pay_type: 'salary', rate: '100' }],
    ['missing pay type', { name: 'Ada', rate: '100' }],
    ['unknown pay type', { name: 'Ada', pay_type: 'weekly', rate: '100' }],
    ['missing rate', { name: 'Ada', pay_type: 'salary' }],
    ['empty rate', { name: 'Ada', pay_type: 'salary', rate: '' }],
    ['non-numeric rate', { name: 'Ada', pay_type: 'salary', rate: 'abc' }],
    ['too many decimals', { name: 'Ada', pay_type: 'salary', rate: '1.234' }],
    ['negative rate', { name: 'Ada', pay_type: 'salary', rate: '-100' }],
    ['huge rate', { name: 'Ada', pay_type: 'salary', rate: '9999999999' }],
  ];

  for (const [label, body] of cases) {
    test(`${label} is rejected`, () => {
      assert.throws(() => validateEmployee(body), ValidationError);
    });
  }

  test('error messages are user-safe (no stack/internal text)', () => {
    try {
      validateEmployee({ name: '', pay_type: 'salary', rate: '1' });
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof ValidationError);
      assert.equal(err.name, 'ValidationError');
      assert.ok(!err.message.includes('at Object'));
    }
  });
});

describe('validateHours', () => {
  test('accepts valid hours', () => {
    assert.equal(validateHours(0), 0);
    assert.equal(validateHours(40), 40);
    assert.equal(validateHours(0.5), 0.5);
  });

  test('rejects missing, non-numeric, negative and absurd hours', () => {
    assert.throws(() => validateHours(undefined), ValidationError);
    assert.throws(() => validateHours(NaN), ValidationError);
    assert.throws(() => validateHours(Infinity), ValidationError);
    assert.throws(() => validateHours('abc'), ValidationError);
    assert.throws(() => validateHours(-1), ValidationError);
    assert.throws(() => validateHours(1001), ValidationError);
  });
});

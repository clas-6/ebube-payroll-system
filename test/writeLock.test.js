'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { withWriteLock } = require('../src/db/writeLock');

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('withWriteLock', () => {
  test('runs queued jobs one at a time, in submission order', async () => {
    const events = [];

    const first = withWriteLock(async () => {
      events.push('first:start');
      await tick(30);
      events.push('first:end');
      return 'first';
    });
    const second = withWriteLock(async () => {
      events.push('second:start');
      await tick(1);
      events.push('second:end');
      return 'second';
    });

    const results = await Promise.all([first, second]);
    assert.deepEqual(results, ['first', 'second']);
    // The slow job must finish before the fast one starts: no interleaving.
    assert.deepEqual(events, ['first:start', 'first:end', 'second:start', 'second:end']);
  });

  test('a rejected job does not block the jobs behind it', async () => {
    const failing = withWriteLock(() => Promise.reject(new Error('boom')));
    const following = withWriteLock(() => Promise.resolve('ok'));

    await assert.rejects(failing, /boom/);
    assert.equal(await following, 'ok');
  });

  test('the queue keeps working after a rejection', async () => {
    await assert.rejects(withWriteLock(() => Promise.reject(new Error('x'))), /x/);
    assert.equal(await withWriteLock(() => 'after'), 'after');
  });

  test('errors are surfaced to the caller of the failing job only', async () => {
    const ok = await Promise.all([
      withWriteLock(() => Promise.reject(new Error('nope'))).catch((e) => e.message),
      withWriteLock(() => 'fine'),
    ]);
    assert.deepEqual(ok, ['nope', 'fine']);
  });
});
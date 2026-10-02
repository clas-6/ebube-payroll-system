'use strict';

/**
 * A tiny process-wide FIFO lock for database writes.
 *
 * WHY THIS EXISTS:
 * node-sqlite3 runs one connection for the whole process and queues statements
 * from every request together. Its `serialize()` only guarantees ordering for
 * statements scheduled *directly* inside the callback - statements scheduled
 * from nested callbacks (which is how a transaction must issue its statements,
 * because it needs the row id from the previous insert) are not covered.
 *
 * Without this lock a concurrent write from another request could be queued
 * between our `BEGIN` and `COMMIT`, and would then be committed - or rolled
 * back - as part of that transaction. Holding a lock across the whole
 * transaction keeps other writes out of the window.
 *
 * Writes are queued in submission order; a rejected job never blocks the ones
 * behind it.
 */

let tail = Promise.resolve();

/**
 * Run `job` (which must return a Promise) after all previously queued jobs
 * have settled. Returns the job's own promise so callers see its result/error.
 *
 * @template T
 * @param {() => Promise<T>} job
 * @returns {Promise<T>}
 */
function withWriteLock(job) {
  const result = tail.then(() => job());
  // Advance the queue regardless of success, so one failure cannot wedge it.
  tail = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

module.exports = { withWriteLock };
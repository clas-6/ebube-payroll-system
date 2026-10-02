'use strict';

const sqlite3 = require('sqlite3').verbose();
const { createSchema } = require('../../src/db/schema');

/**
 * Open an in-memory SQLite database with the full schema applied.
 * Resolves to the open handle; always call `.close()` when done.
 */
async function openTestDb() {
  const db = new sqlite3.Database(':memory:');
  await new Promise((resolve, reject) => {
    db.run('PRAGMA foreign_keys = ON', (err) => (err ? reject(err) : resolve()));
  });
  await createSchema(db);
  return db;
}

/** Run a single statement, resolving to the lastID/changes. */
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

/** Fetch all rows from a query. */
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

/** Close the database handle. */
function close(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

module.exports = { openTestDb, run, all, close };

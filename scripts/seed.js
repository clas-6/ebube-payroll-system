'use strict';

/**
 * Seed the database with FAKE demo data.
 *
 * Usage:  npm run seed
 *
 * Creates (idempotently):
 *   - two demo users: `admin` (admin role) and `viewer` (viewer role)
 *   - four demo employees with obviously-fake names
 *
 * NO real employee data. Passwords are printed to the console only.
 */

const db = require('../database');
const { hashPassword } = require('../src/services/auth');

const USERS = [
  { username: 'admin', password: 'admin-demo-2026', role: 'admin' },
  { username: 'viewer', password: 'viewer-demo-2026', role: 'viewer' },
];

const EMPLOYEES = [
  { name: 'Demo Alice (fake)', payType: 'salary', rateCents: 5_000_000 },
  { name: 'Demo Bob (fake)', payType: 'hourly', rateCents: 2_000 },
  { name: 'Demo Carol (fake)', payType: 'salary', rateCents: 7_200_000 },
  { name: 'Demo Dave (fake)', payType: 'hourly', rateCents: 1_750 },
];

function tableExists(name) {
  return new Promise((resolve) => {
    db.get('SELECT name FROM sqlite_master WHERE type = ? AND name = ?', ['table', name], (err, row) => {
      resolve(Boolean(row));
    });
  });
}

function insertUser({ username, password, role }) {
  return hashPassword(password).then(
    (hash) =>
      new Promise((resolve, reject) => {
        db.run(
          'INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, ?)',
          [username, hash, role],
          function onInsert(err) {
            if (err) reject(err);
            else resolve(this.changes);
          }
        );
      })
  );
}

function insertEmployee({ name, payType, rateCents }) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO employees (name, pay_type, rate_cents) VALUES (?, ?, ?)',
      [name, payType, rateCents],
      function onInsert(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

async function seed() {
  // Wait for schema bootstrap (database.js creates it async on connect).
  for (let i = 0; i < 50; i++) {
    if (await tableExists('users')) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!(await tableExists('users'))) {
    console.error('Schema not ready - is the database reachable?');
    process.exit(1);
  }

  console.log('Seeding demo users...');
  for (const u of USERS) {
    await insertUser(u);
    console.log(`  user "${u.username}" role=${u.role} password=${u.password}`);
  }

  console.log('Seeding demo employees (fake data)...');
  for (const e of EMPLOYEES) {
    await insertEmployee(e);
    console.log(`  employee "${e.name}" payType=${e.payType}`);
  }

  console.log('\nSeed complete. Demo credentials above are for local demo only.');
  console.log('CHANGE THEM before any real use. Never commit real credentials.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});

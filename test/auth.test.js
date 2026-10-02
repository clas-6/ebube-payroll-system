'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { openTestDb, run, all, close } = require('./helpers/testDb');
const {
  hashPassword,
  verifyPassword,
  findUserByUsername,
  requireRole,
  hasRole,
  recordAudit,
  listAudit,
} = require('../src/services/auth');

let db;

beforeEach(async () => {
  db = await openTestDb();
});

afterEach(async () => {
  await close(db);
});

describe('password hashing', () => {
  test('hashes a password and verifies it', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.ok(typeof hash === 'string');
    assert.ok(!hash.includes('correct horse'), 'hash must not contain plaintext');
    assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  });

  test('rejects a wrong password', async () => {
    const hash = await hashPassword('secret');
    assert.equal(await verifyPassword('wrong', hash), false);
  });

  test('produces a different hash each time (salted)', async () => {
    const a = await hashPassword('secret');
    const b = await hashPassword('secret');
    assert.notEqual(a, b);
    assert.equal(await verifyPassword('secret', a), true);
    assert.equal(await verifyPassword('secret', b), true);
  });

  test('verify handles malformed inputs without throwing', async () => {
    assert.equal(await verifyPassword(null, 'x'), false);
    assert.equal(await verifyPassword('x', null), false);
    assert.equal(await verifyPassword(undefined, undefined), false);
  });
});

describe('findUserByUsername', () => {
  beforeEach(async () => {
    const hash = await hashPassword('pw12345');
    await run(db, 'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [
      'Admin',
      hash,
      'admin',
    ]);
  });

  test('finds an existing user', async () => {
    const user = await findUserByUsername(db, 'Admin');
    assert.ok(user);
    assert.equal(user.username, 'Admin');
    assert.equal(user.role, 'admin');
    assert.ok(user.password_hash);
  });

  test('matches case-insensitively', async () => {
    const user = await findUserByUsername(db, 'admin');
    assert.ok(user, 'username lookup should be case-insensitive');
  });

  test('returns null for unknown or empty usernames', async () => {
    assert.equal(await findUserByUsername(db, 'nobody'), null);
    assert.equal(await findUserByUsername(db, ''), null);
    assert.equal(await findUserByUsername(db, null), null);
  });
});

describe('role enforcement', () => {
  function makeRes() {
    const res = {
      statusCode: null,
      redirectedTo: null,
      renderedView: null,
      renderedData: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      redirect(url) {
        this.redirectedTo = url;
        return this;
      },
      send() {
        return this;
      },
      render(view, data) {
        this.renderedView = view;
        this.renderedData = data;
        return this;
      },
      accepts() {
        return 'html';
      },
    };
    return res;
  }

  test('viewer is blocked from an admin-only action with 403', () => {
    const guard = requireRole('admin');
    const req = { session: { user: { role: 'viewer' } }, method: 'POST', accepts: () => 'html' };
    const res = makeRes();
    let nextCalled = false;
    guard(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.renderedView, 'error');
  });

  test('admin is allowed through', () => {
    const guard = requireRole('admin');
    const req = { session: { user: { role: 'admin' } }, accepts: () => 'html' };
    const res = makeRes();
    let nextCalled = false;
    guard(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  test('unauthenticated request is redirected to login', () => {
    const guard = requireRole('admin');
    const req = { session: {}, method: 'GET', accepts: () => 'html' };
    const res = makeRes();
    let nextCalled = false;
    guard(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.redirectedTo, '/login');
  });

  test('hasRole reflects the session role', () => {
    assert.equal(hasRole({ session: { user: { role: 'viewer' } } }, 'admin'), false);
    assert.equal(hasRole({ session: { user: { role: 'admin' } } }, 'admin', 'viewer'), true);
    assert.equal(hasRole({}, 'admin'), false);
  });
});

describe('audit log', () => {
  test('records an entry with actor, action and entity', async () => {
    const id = await recordAudit(db, {
      actor: 'admin',
      action: 'create',
      entity: 'employee',
      entityId: 7,
      detail: 'Added Demo Alice',
    });
    assert.ok(id);
    const rows = await listAudit(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor, 'admin');
    assert.equal(rows[0].action, 'create');
    assert.equal(rows[0].entity, 'employee');
    assert.equal(rows[0].entity_id, '7');
    assert.ok(rows[0].created_at);
  });

  test('defaults actor to anonymous and never throws on bad input', async () => {
    const id = await recordAudit(db, { action: 'login' });
    assert.ok(id);
    const rows = await listAudit(db);
    assert.equal(rows[0].actor, 'anonymous');
  });

  test('lists newest first and respects the limit', async () => {
    for (let i = 1; i <= 5; i++) {
      await recordAudit(db, { actor: 'admin', action: `action-${i}` });
    }
    const rows = await listAudit(db, 3);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].action, 'action-5');
  });
});

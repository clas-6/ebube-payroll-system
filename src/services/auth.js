'use strict';

/**
 * Authentication, authorization and audit logging.
 *
 * Passwords are hashed with bcrypt (cost factor kept at 10 for a demo; raise
 * it for production). Sessions are cookie-based via express-session.
 *
 * ROLES:
 *   admin  - full access: view, add employees, run payroll.
 *   viewer - read-only: may view data but not change it.
 */

const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 10;

/** Hash a plaintext password. */
function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

/** Constant-time-ish verification of a plaintext password against a hash. */
function verifyPassword(plaintext, hash) {
  if (typeof plaintext !== 'string' || typeof hash !== 'string') {
    return Promise.resolve(false);
  }
  return bcrypt.compare(plaintext, hash);
}

/** Find a user by username (case-insensitive). */
function findUserByUsername(db, username) {
  return new Promise((resolve, reject) => {
    if (typeof username !== 'string' || !username.trim()) return resolve(null);
    db.get(
      'SELECT id, username, password_hash, role FROM users WHERE username = ?',
      [username.trim()],
      (err, row) => (err ? reject(err) : resolve(row || null))
    );
  });
}

/**
 * Require an authenticated session.
 * Sends 401 (API-ish) but redirects browsers to /login.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.method === 'GET' && req.accepts('html')) {
    return res.redirect('/login');
  }
  return res.status(401).send('Authentication required');
}

/**
 * Require a specific role. Must be used after requireAuth.
 * @param  {...string} roles allowed roles
 */
function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.session || !req.session.user) {
      if (req.accepts('html')) return res.redirect('/login');
      return res.status(401).send('Authentication required');
    }
    if (roles.includes(req.session.user.role)) return next();
    return res.status(403).render('error', {
      status: 403,
      message: 'You do not have permission to perform this action.',
    });
  };
}

/** True when the current session user has one of the given roles. */
function hasRole(req, ...roles) {
  return Boolean(req.session && req.session.user && roles.includes(req.session.user.role));
}

/** Append an entry to the audit log (never throws). */
function recordAudit(db, { actor, action, entity, entityId, detail }) {
  return new Promise((resolve) => {
    const safeActor = actor || 'anonymous';
    db.run(
      'INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
      [safeActor, action || 'unknown', entity || null, entityId == null ? null : String(entityId), detail || null],
      function onInsert(err) {
        if (err) {
          console.error('audit log write failed', err.message);
          return resolve(null);
        }
        resolve(this.lastID);
      }
    );
  });
}

/** Read the audit log, newest first. */
function listAudit(db, limit = 100) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM audit_log ORDER BY id DESC LIMIT ?',
      [Math.max(1, Math.min(Number(limit) || 100, 500))],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

module.exports = {
  hashPassword,
  verifyPassword,
  findUserByUsername,
  requireAuth,
  requireRole,
  hasRole,
  recordAudit,
  listAudit,
  BCRYPT_ROUNDS,
};

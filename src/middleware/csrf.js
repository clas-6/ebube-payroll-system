'use strict';

/**
 * CSRF protection using a per-session token (double-submit pattern).
 *
 * Every session gets a random token. HTML forms include it as a hidden
 * field; POST requests must present a matching token. Comparison is
 * timing-safe to avoid leaking the token length/bytes.
 */

const crypto = require('crypto');

const CSRF_FIELD = '_csrf';
const CSRF_HEADER = 'x-csrf-token';

/** Mint a fresh token (hex string). */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Constant-time string comparison. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Ensure the session has a token; expose it to views. */
function csrfTokenMiddleware(req, res, next) {
  if (!req.session) return next();
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

/** Validate the token on state-changing requests. */
function csrfProtection(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  if (!req.session || !req.session.csrfToken) {
    return res.status(403).render('error', {
      status: 403,
      message: 'Your session is invalid or expired. Please sign in again.',
    });
  }

  const provided =
    (req.body && req.body[CSRF_FIELD]) || req.get(CSRF_HEADER) || null;

  if (!safeEqual(provided, req.session.csrfToken)) {
    return res.status(403).render('error', {
      status: 403,
      message: 'Invalid or missing security token. Please go back and try again.',
    });
  }

  // Prevent the token being replayed from the body on the next request.
  delete req.body[CSRF_FIELD];
  next();
}

module.exports = {
  generateToken,
  safeEqual,
  csrfTokenMiddleware,
  csrfProtection,
  CSRF_FIELD,
  CSRF_HEADER,
};

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  generateToken,
  safeEqual,
  csrfTokenMiddleware,
  csrfProtection,
} = require('../src/middleware/csrf');

function makeReqRes({ method = 'POST', body = {}, session = null, header = null } = {}) {
  const req = {
    method,
    body,
    session,
    get(name) {
      return header && name.toLowerCase() === header.name.toLowerCase() ? header.value : undefined;
    },
  };
  const res = {
    statusCode: 200,
    renderedView: null,
    renderedData: null,
    locals: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    render(view, data) {
      this.renderedView = view;
      this.renderedData = data;
      return this;
    },
    send() {
      return this;
    },
  };
  return { req, res };
}

describe('generateToken', () => {
  test('produces a 64-char hex token', () => {
    const t = generateToken();
    assert.equal(t.length, 64);
    assert.match(t, /^[0-9a-f]+$/);
  });

  test('produces unique tokens', () => {
    assert.notEqual(generateToken(), generateToken());
  });
});

describe('safeEqual', () => {
  test('matches identical strings', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
  });

  test('rejects different strings and lengths', () => {
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('', 'abc'), false);
  });

  test('rejects non-strings without throwing', () => {
    assert.equal(safeEqual(null, 'x'), false);
    assert.equal(safeEqual('x', undefined), false);
    assert.equal(safeEqual(null, null), false);
  });
});

describe('csrfTokenMiddleware', () => {
  test('creates a token and exposes it to views', () => {
    const session = {};
    const { req, res } = makeReqRes({ session });
    csrfTokenMiddleware(req, res, () => {});
    assert.ok(session.csrfToken);
    assert.equal(res.locals.csrfToken, session.csrfToken);
  });

  test('reuses an existing token', () => {
    const session = { csrfToken: 'existing-token' };
    const { req, res } = makeReqRes({ session });
    csrfTokenMiddleware(req, res, () => {});
    assert.equal(session.csrfToken, 'existing-token');
  });
});

describe('csrfProtection', () => {
  const token = 'a'.repeat(64);

  test('allows GET requests through', () => {
    const { req, res } = makeReqRes({ method: 'GET', session: { csrfToken: token } });
    let nextCalled = false;
    csrfProtection(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  test('allows a POST with a valid token', () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { _csrf: token, name: 'x' },
      session: { csrfToken: token },
    });
    let nextCalled = false;
    csrfProtection(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(req.body._csrf, undefined, 'token should be stripped from body');
  });

  test('rejects a POST with a missing token', () => {
    const { req, res } = makeReqRes({ method: 'POST', body: {}, session: { csrfToken: token } });
    let nextCalled = false;
    csrfProtection(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.renderedView, 'error');
  });

  test('rejects a POST with a wrong token', () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { _csrf: 'b'.repeat(64) },
      session: { csrfToken: token },
    });
    let nextCalled = false;
    csrfProtection(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  test('rejects a POST with no session token', () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: { _csrf: token },
      session: {},
    });
    let nextCalled = false;
    csrfProtection(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });

  test('accepts the token from a header instead of the body', () => {
    const { req, res } = makeReqRes({
      method: 'POST',
      body: {},
      session: { csrfToken: token },
      header: { name: 'x-csrf-token', value: token },
    });
    let nextCalled = false;
    csrfProtection(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });
});

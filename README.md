# Ebube Payroll System — Prototype

A small, **demo-ready but deliberately limited** payroll prototype. It manages
employee records, calculates one pay period per run, and stores each finalized
run as an **immutable history record** with an audit trail.

> ⚠️ **This is a prototype, NOT production software.**
> It is built to demonstrate correct payroll *arithmetic* and *record-keeping*
> honestly. It is **not** a compliant payroll system. See
> [Known limitations](#known-limitations) before using it for anything real.
> The tax logic (a flat 15%) is a placeholder and is **not legal or tax advice**.

---

## What this prototype demonstrates

1. **Correct money math** — all amounts are stored and computed as **integer
   cents**, never floats. `gross − tax === net` holds by construction, so the
   figures on screen always add up.
2. **Immutable payroll history** — a finalized run cannot be edited or deleted.
   This is enforced by **SQLite triggers**, not application code, so it holds
   even if a future bug or route tries to change it.
3. **Authentication, roles and an audit log** — `admin` vs `viewer`, cookie
   sessions, hashed passwords, and an append-only record of who did what.
4. **Form hardening** — server-side validation on every write and a per-session
   **CSRF token** on every state-changing request.

---

## Quick start (demo)

```bash
npm install        # installs deps (sqlite3 builds natively; see Troubleshooting)
npm run seed       # creates fake demo users + fake demo employees
npm start          # http://localhost:3000
```

`npm run seed` prints two **fake** demo logins to the console:

| Username | Password            | Role     | Can do                            |
| -------- | ------------------- | -------- | --------------------------------- |
| `admin`  | `admin-demo-2026`   | admin    | view, add employees, run payroll  |
| `viewer` | `viewer-demo-2026`  | viewer   | view only (writes are blocked)    |

These credentials are for **local demo only**. They are printed, not committed,
and do not exist unless you run the seed script.

The database file `payroll.db` is created automatically on first run and is
**git-ignored**.

---

## Tech stack

* **Runtime:** Node.js (CommonJS)
* **Server:** Express 5
* **Database:** SQLite via `sqlite3` (local file `payroll.db`)
* **Views:** EJS server-rendered templates
* **Auth:** `bcryptjs` for password hashing, `express-session` for sessions
* **Headers:** `helmet` (see the caveat below — it is a **devDependency**)
* **Tests:** Node's built-in `node:test` runner (no extra test framework)

---

## npm scripts

| Script         | Command                            | Purpose                            |
| -------------- | ---------------------------------- | ---------------------------------- |
| `npm start`    | `node server.js`                   | Start the server                   |
| `npm run seed` | `node scripts/seed.js`             | Insert fake demo users + employees |
| `npm test`     | `node --test --test-reporter spec` | Run the unit test suite            |

---

## Project structure

```
server.js                     Express app: middleware, routes, error handling
database.js                   Opens SQLite; runs legacy migration + schema
scripts/seed.js               Fake demo data seeder (idempotent)
src/db/schema.js              Table DDL + immutability triggers
src/services/payroll.js       Pure calculation (cents in, cents out)
src/services/payrollRun.js    Atomic finalize + history queries
src/services/auth.js          Hashing, role guards, audit log
src/middleware/csrf.js        Per-session CSRF token + validation
src/utils/money.js            dollarsToCents / formatCents
src/utils/hours.js            Parses `hours_<id>` form keys (see below)
src/utils/validate.js         Form payload validation
views/                        EJS templates (partials/nav.ejs is shared)
test/                         Unit tests (node:test)
```

---

## Data model

Five tables (`src/db/schema.js`). **All `*_cents` columns are INTEGER minor units.**

| Table         | Purpose                     | Key columns                                                                         |
| ------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| `users`       | Login accounts              | `username` (unique, case-insensitive), `password_hash`, `role` (admin or viewer)   |
| `employees`   | Employee roster             | `name`, `pay_type` (hourly or salary), `rate_cents` (INTEGER ≥ 0)                  |
| `pay_periods` | One finalized run           | `label`, `pay_frequency`, `tax_rate`, totals, `finalized_at`; `UNIQUE(label, pay_frequency)` |
| `pay_stubs`   | One row per employee per run| `period_id`, `employee_id`, hours, gross/tax/net cents, `tax_rate`; `UNIQUE(period_id, employee_id)` |
| `audit_log`   | Who did what                | `actor`, `action`, `entity`, `entity_id`, `detail`, `created_at`                    |

### Immutability

`BEFORE UPDATE` / `BEFORE DELETE` triggers on `pay_periods` and `pay_stubs` call
`RAISE(ABORT, ...)`, so finalized records can be **inserted but never changed or
removed**. The test suite asserts these triggers actually fire.

### Legacy data

If an old database with a `rate` (REAL, dollars) column is found, `database.js`
renames it to `rate_cents` and multiplies by 100 once, then stops.

---

## Money handling

* Parsing: `dollarsToCents("20.50") → 2050`. Only up to 2 decimals are accepted;
  anything else is rejected rather than silently truncated.
* Arithmetic: integer cents only, rounded **half away from zero** (deterministic,
  unlike `toFixed`).
* Formatting: `formatCents(192308) → "1,923.08"`, used **only** at display time.
* Salaried pay per period = annual rate ÷ **26** (bi-weekly).
* Hourly pay per period = hourly rate × hours worked.
* Tax = gross × **15%** (flat, demo only).
* Values are bounded by `Number.MAX_SAFE_INTEGER`.

---

## Authentication, roles and audit

* Passwords are hashed with **bcrypt (cost 10)**; plaintext is never stored.
  Login is case-insensitive on username.
* Sessions are cookie-based (`httpOnly`, `sameSite=lax`, 8-hour expiry).
* **`admin`** can add employees and run payroll. **`viewer`** can only view;
  write routes return **403**, and the *Add Employee* / *Audit Log* links are
  hidden from viewers.
* Unauthenticated browser requests are redirected to `/login`; non-HTML requests
  get **401**.
* Every login, failed login, logout, employee creation and payroll finalization
  is appended to `audit_log`. `/audit` (admin-only) shows the latest 200 entries.
  Audit writes **never throw** — a logging failure cannot break a request.

### CSRF

Every session gets a random token, exposed to views and included as a hidden
`_csrf` field in every form (or an `X-CSRF-Token` header). Tokens are compared
with `crypto.timingSafeEqual`. A missing or wrong token yields **403** before any
route logic runs.

---

## Routes

| Method | Path                 | Access        | Notes                                             |
| ------ | -------------------- | ------------- | ------------------------------------------------- |
| GET    | `/login`             | public        | Redirects to `/` if already signed in             |
| POST   | `/login`             | public        | 401 on bad credentials (audited)                  |
| POST   | `/logout`            | authenticated | Destroys session (audited)                        |
| GET    | `/`                  | authenticated | Employee list                                     |
| GET    | `/add-employee`      | admin         | Form                                              |
| POST   | `/add-employee`      | admin         | Validates; 400 with inline error on bad input     |
| GET    | `/payroll`           | authenticated | Hours-entry form                                  |
| POST   | `/calculate-payroll` | admin         | Computes + finalizes a run; 400 / 409 on problems |
| GET    | `/history`           | authenticated | List of finalized runs                            |
| GET    | `/history/:id`       | authenticated | Read-only run detail                              |
| GET    | `/audit`             | admin         | Latest 200 audit entries                          |

`POST /calculate-payroll` returns **409** if a run with the same label already
exists, and **400** if any hourly employee's hours are missing or invalid.

### Why `hours_<id>` and not `hours[<id>]`

The original form used `hours[1]`, `hours[2]`, … Express's query parser (`qs`)
collapses numeric-bracket keys into a **0-indexed array**, so `hours[1]` shifted
into slot 1 and employees were paid with the *next* employee's hours. The form
now uses flat keys (`hours_12`), and `extractHoursMap` **ignores** any legacy
array-shaped `hours` entirely — failing safe to "no hours supplied" (a visible
validation error) rather than paying the wrong person.

---

## Validation rules

* **Name:** required, trimmed, ≤ 120 characters.
* **Pay type:** `hourly` or `salary`.
* **Rate:** valid amount, ≥ 0, ≤ $10,000,000.00, at most 2 decimals.
* **Hours:** required for hourly staff, a finite number, 0–1000.

---

## Testing

```bash
npm test
```

**124 tests / 25 suites**, covering: money parsing & formatting, payroll math
(incl. `gross − tax === net`), the hours-key fix, validation, schema/trigger
immutability, run persistence, auth/role guards, and CSRF.

---

## Known limitations

**Security / operations**

* `SESSION_SECRET` **defaults to an insecure dev string**. Set the env var
  (`SESSION_SECRET=…`) for anything beyond a local demo. There is no HTTPS,
  no login rate-limiting, and no account lockout.
* `express-session` uses its default in-memory store — it does not survive
  restarts or scale across processes, and is not intended for production.
* `helmet` is declared as a **devDependency** (kept out of runtime deps so
  `npm ci --omit=dev` still works). If it is absent, the app warns and continues
  **without security headers**. `contentSecurityPolicy` is disabled.
* The CSRF token is per-session and is not rotated on every request.
* There is no password-change / reset flow, and no user-management UI.

**Payroll correctness / domain**

* Tax is a **flat 15%** placeholder — no brackets, jurisdictions, deductions,
  benefits, overtime, or pre/post-tax rules.
* Salary assumes **26 bi-weekly** periods; `pay_periods.pay_frequency` allows
  `weekly`/`monthly`, but the UI only ever writes the bi-weekly default.
* Hours are a single number per employee per run — no timesheets, PTO, or
  multiple pay codes.
* Because runs are immutable, a mistaken run **cannot be corrected**; there is
  no reversal / compensating-run flow yet.

**Records / UI**

* Employees can be **added but not edited or deleted** (no soft-delete either).
* No pagination on the employee list or history; `/audit` is capped at 200 rows.
* Data lives in a single local SQLite file, with no backups or export.
* These are demo figures only — **not** pay slips, tax documents, or legal advice.

---

## Troubleshooting

* **`sqlite3` fails to install** — it builds natively via `node-gyp`. Ensure
  build tools are available (on Windows, VS Build Tools). Recent npm may warn
  about unapproved install scripts; approve `sqlite3` if prompted.
* **"Schema not ready" from the seeder** — start the server once (or run
  `node server.js`) so `database.js` can create the schema, then re-run the seed.
* **Port already in use** — set `PORT`, e.g. `PORT=3001 npm start`.
* **Reset demo data** — stop the server, delete `payroll.db`, then re-run
  `npm run seed`.
const express = require('express');
const path = require('path');
const session = require('express-session');
const db = require('./database');

const { PayrollInputError } = require('./src/services/payroll');
const { finalizePayrollRun, listPeriods, listStubsForPeriod, getPeriod } = require('./src/services/payrollRun');
const { validateEmployee, validateHours, ValidationError } = require('./src/utils/validate');
const { extractHoursMap, toHours } = require('./src/utils/hours');
const { formatCents } = require('./src/utils/money');
const {
    hashPassword,
    verifyPassword,
    findUserByUsername,
    requireAuth,
    requireRole,
    recordAudit,
    listAudit,
} = require('./src/services/auth');
const { csrfTokenMiddleware, csrfProtection } = require('./src/middleware/csrf');
const { withWriteLock } = require('./src/db/writeLock');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const FALLBACK_SESSION_SECRET = 'dev-only-insecure-secret-change-me';
// Tracked so we can refuse to start in production with a known-public secret.
const USING_FALLBACK_SECRET = !process.env.SESSION_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET || FALLBACK_SESSION_SECRET;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers. `helmet` is a devDependency, so a production install
// (`npm ci --omit=dev`) may not include it. Requiring it at the top of the
// file would crash startup, so it is loaded lazily and skipped if absent.
let helmet = null;
try {
    helmet = require('helmet');
} catch (err) {
    helmet = null;
}
if (helmet) {
    app.use(helmet({ contentSecurityPolicy: false }));
} else {
    console.warn('helmet unavailable; security headers not applied');
}

app.use(
    session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: 'lax',
            // Only send the cookie over HTTPS in production. Set to false in
            // local/dev so it works over plain http://localhost.
            secure: IS_PRODUCTION,
            maxAge: 8 * 60 * 60 * 1000, // 8 hours
        },
    })
);
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// Expose the current user and role helper to every view.
app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    res.locals.isAdmin = Boolean(req.session.user && req.session.user.role === 'admin');
    next();
});

// CSRF: mint/refresh a per-session token, then validate it on all writes.
app.use(csrfTokenMiddleware);
app.use(csrfProtection);

// Prepare employee rows for display (money formatting happens here only).
function forDisplay(rows) {
    return rows.map((emp) => ({
        ...emp,
        rate_display: formatCents(emp.rate_cents),
    }));
}

// Render the shared error page for a missing resource (keeps 404s styled and
// consistent with the 403 page rather than a bare text response).
function renderNotFound(res) {
    return res.status(404).render('error', {
        status: 404,
        message: 'The page you requested was not found.',
    });
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    res.render('login', { error: null });
});

app.post('/login', (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    findUserByUsername(db, username)
        .then((user) => {
            if (!user) {
                recordAudit(db, { actor: username || 'anonymous', action: 'login_failed', detail: 'unknown user' });
                return res.status(401).render('login', { error: 'Invalid username or password.' });
            }
            return verifyPassword(password, user.password_hash).then((ok) => {
                if (!ok) {
                    recordAudit(db, { actor: user.username, action: 'login_failed', detail: 'bad password' });
                    return res.status(401).render('login', { error: 'Invalid username or password.' });
                }
                // Guard against session fixation: issue a fresh session id when
                // privileges are granted, then attach the authenticated user.
                return req.session.regenerate((regenErr) => {
                    if (regenErr) {
                        recordAudit(db, {
                            actor: user.username,
                            action: 'login_failed',
                            detail: 'session regenerate error',
                        });
                        return res.status(500).render('login', { error: 'Unable to sign in right now.' });
                    }
                    req.session.user = { id: user.id, username: user.username, role: user.role };
                    recordAudit(db, { actor: user.username, action: 'login', detail: `role=${user.role}` });
                    return res.redirect('/');
                });
            });
        })
        .catch(() => res.status(500).render('login', { error: 'Unable to sign in right now.' }));
});

app.post('/logout', (req, res) => {
    const actor = req.session.user ? req.session.user.username : 'anonymous';
    req.session.destroy(() => {
        recordAudit(db, { actor, action: 'logout' });
        res.redirect('/login');
    });
});

// Audit log is admin-only.
app.get('/audit', requireAuth, requireRole('admin'), (req, res, next) => {
    listAudit(db, 200)
        .then((entries) => {
            res.render('audit', {
                entries: entries.map((e) => ({
                    actor: e.actor,
                    action: e.action,
                    entity: e.entity,
                    entityId: e.entity_id,
                    detail: e.detail,
                    createdAt: e.created_at,
                })),
            });
        })
        .catch(next);
});

// ---------------------------------------------------------------------------
// Application routes (read-only for viewers, writes require admin)
// ---------------------------------------------------------------------------

app.get('/', requireAuth, (req, res) => {
    db.all('SELECT * FROM employees ORDER BY id', [], (err, rows) => {
        if (err) return res.status(500).send('Database error');
        res.render('index', {
            employees: forDisplay(rows),
            notice: req.query.saved ? 'Employee saved.' : null,
            error: req.query.error || null,
        });
    });
});

app.get('/add-employee', requireAuth, requireRole('admin'), (req, res) => {
    res.render('add-employee', { error: null, values: {} });
});

app.post('/add-employee', requireAuth, requireRole('admin'), (req, res, next) => {
    let employee;
    try {
        employee = validateEmployee(req.body);
    } catch (err) {
        if (err instanceof ValidationError) {
            return res.status(400).render('add-employee', {
                error: err.message,
                values: req.body || {},
            });
        }
        return next(err);
    }

    withWriteLock(
        () =>
            new Promise((resolve, reject) => {
                db.run(
                    'INSERT INTO employees (name, pay_type, rate_cents) VALUES (?, ?, ?)',
                    [employee.name, employee.payType, employee.rateCents],
                    function onInserted(err) {
                        if (err) return reject(err);
                        resolve(this.lastID);
                    }
                );
            })
    )
        .then((employeeId) => {
            recordAudit(db, {
                actor: req.session.user.username,
                action: 'create',
                entity: 'employee',
                entityId: employeeId,
                detail: `${employee.name} (${employee.payType})`,
            });
            res.redirect('/?saved=1');
        })
        .catch(() => res.status(500).send('Error saving employee'));
});

// The payroll page is a submission form, so read-only viewers are excluded.
app.get('/payroll', requireAuth, requireRole('admin'), (req, res) => {
    db.all('SELECT * FROM employees ORDER BY id', [], (err, employees) => {
        if (err) return res.status(500).send('Database error');
        res.render('payroll', { employees: forDisplay(employees), error: null });
    });
});

app.post('/calculate-payroll', requireAuth, requireRole('admin'), (req, res, next) => {
    const hoursMap = extractHoursMap(req.body);
    const label =
        typeof req.body.period_label === 'string' && req.body.period_label.trim()
            ? req.body.period_label.trim()
            : defaultPeriodLabel();

    db.all('SELECT * FROM employees ORDER BY id', [], (err, employees) => {
        if (err) return res.status(500).send('Database error');

        if (employees.length === 0) {
            return res.status(400).render('payroll', {
                employees: [],
                error: 'Add at least one employee before running payroll.',
            });
        }

        // Validate every hourly employee's hours BEFORE persisting anything.
        const hoursById = {};
        try {
            for (const emp of employees) {
                if (emp.pay_type === 'hourly') {
                    hoursById[emp.id] = validateHours(toHours(hoursMap[emp.id]));
                }
            }
        } catch (validationErr) {
            if (validationErr instanceof ValidationError) {
                return res.status(400).render('payroll', {
                    employees: forDisplay(employees),
                    error: validationErr.message,
                });
            }
            return next(validationErr);
        }

        finalizePayrollRun(db, {
            label,
            employees,
            hoursMap: hoursById,
        })
            .then(({ periodId, stubs, totals }) => {
                recordAudit(db, {
                    actor: req.session.user.username,
                    action: 'finalize_payroll_run',
                    entity: 'pay_period',
                    entityId: periodId,
                    detail: `${label} | employees=${stubs.length} | net=${formatCents(totals.netCents)}`,
                });
                res.render('payroll-results', {
                    periodId,
                    label,
                    payStubs: stubs.map((s) => ({
                        name: s.employeeName,
                        payType: s.payType,
                        grossPay: formatCents(s.grossCents),
                        taxes: formatCents(s.taxCents),
                        netPay: formatCents(s.netCents),
                    })),
                    totals: {
                        grossPay: formatCents(totals.grossCents),
                        taxes: formatCents(totals.taxCents),
                        netPay: formatCents(totals.netCents),
                    },
                });
            })
            .catch((runErr) => {
                if (runErr instanceof PayrollInputError || runErr instanceof ValidationError) {
                    return res.status(400).render('payroll', {
                        employees: forDisplay(employees),
                        error: runErr.message,
                    });
                }
                if (runErr && /UNIQUE constraint/i.test(runErr.message)) {
                    return res.status(409).render('payroll', {
                        employees: forDisplay(employees),
                        error: `A payroll run for "${label}" already exists. Use a different period label.`,
                    });
                }
                next(runErr);
            });
    });
});

// Payroll history: list of finalized runs.
app.get('/history', requireAuth, (req, res, next) => {
    listPeriods(db)
        .then((periods) => {
            res.render('history', {
                periods: periods.map((p) => ({
                    id: p.id,
                    label: p.label,
                    frequency: p.pay_frequency,
                    employeeCount: p.employee_count,
                    grossPay: formatCents(p.total_gross_cents),
                    taxes: formatCents(p.total_tax_cents),
                    netPay: formatCents(p.total_net_cents),
                    finalizedAt: p.finalized_at,
                })),
            });
        })
        .catch(next);
});

// Detail view for one finalized run (read-only; rows are immutable).
app.get('/history/:id', requireAuth, (req, res, next) => {
    const periodId = Number(req.params.id);
    if (!Number.isInteger(periodId) || periodId <= 0) {
        return renderNotFound(res);
    }

    Promise.all([getPeriod(db, periodId), listStubsForPeriod(db, periodId)])
        .then(([period, stubs]) => {
            if (!period) return renderNotFound(res);
            res.render('history-detail', {
                period: {
                    id: period.id,
                    label: period.label,
                    frequency: period.pay_frequency,
                    taxRate: period.tax_rate,
                    finalizedAt: period.finalized_at,
                    employeeCount: period.employee_count,
                    grossPay: formatCents(period.total_gross_cents),
                    taxes: formatCents(period.total_tax_cents),
                    netPay: formatCents(period.total_net_cents),
                },
                stubs: stubs.map((s) => ({
                    name: s.employee_name,
                    payType: s.pay_type,
                    hours: s.hours,
                    grossPay: formatCents(s.gross_cents),
                    taxes: formatCents(s.tax_cents),
                    netPay: formatCents(s.net_cents),
                })),
            });
        })
        .catch(next);
});

function defaultPeriodLabel() {
    const now = new Date();
    const iso = now.toISOString().slice(0, 10);
    return `Payroll run ${iso}`;
}

// 404 handler - render the same styled error page the rest of the app uses.
app.use((req, res) => {
    renderNotFound(res);
});

// Centralized error handler - never leaks stack traces to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (err instanceof ValidationError || err instanceof PayrollInputError) {
        return res.status(400).send(err.message);
    }
    console.error(err);
    res.status(500).send('Internal server error');
});

if (require.main === module) {
    if (USING_FALLBACK_SECRET) {
        if (IS_PRODUCTION) {
            console.error(
                'FATAL: SESSION_SECRET must be set when NODE_ENV=production. ' +
                    'Refusing to start with a publicly-known default secret.'
            );
            process.exit(1);
        }
        console.warn(
            'WARNING: using an insecure default SESSION_SECRET. ' +
                'Set SESSION_SECRET before any use beyond a local demo.'
        );
    }
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;

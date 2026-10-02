const express = require('express');
const path = require('path');
const db = require('./database');

const { PayrollInputError } = require('./src/services/payroll');
const { finalizePayrollRun, listPeriods, listStubsForPeriod, getPeriod } = require('./src/services/payrollRun');
const { validateEmployee, validateHours, ValidationError } = require('./src/utils/validate');
const { extractHoursMap, toHours } = require('./src/utils/hours');
const { formatCents } = require('./src/utils/money');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// Prepare employee rows for display (money formatting happens here only).
function forDisplay(rows) {
    return rows.map((emp) => ({
        ...emp,
        rate_display: formatCents(emp.rate_cents),
    }));
}

app.get('/', (req, res) => {
    db.all('SELECT * FROM employees ORDER BY id', [], (err, rows) => {
        if (err) return res.status(500).send('Database error');
        res.render('index', {
            employees: forDisplay(rows),
            notice: req.query.saved ? 'Employee saved.' : null,
            error: req.query.error || null,
        });
    });
});

app.get('/add-employee', (req, res) => {
    res.render('add-employee', { error: null, values: {} });
});

app.post('/add-employee', (req, res) => {
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
        throw err;
    }

    db.run(
        'INSERT INTO employees (name, pay_type, rate_cents) VALUES (?, ?, ?)',
        [employee.name, employee.payType, employee.rateCents],
        (err) => {
            if (err) return res.status(500).send('Error saving employee');
            res.redirect('/?saved=1');
        }
    );
});

app.get('/payroll', (req, res) => {
    db.all('SELECT * FROM employees ORDER BY id', [], (err, employees) => {
        if (err) return res.status(500).send('Database error');
        res.render('payroll', { employees: forDisplay(employees), error: null });
    });
});

app.post('/calculate-payroll', (req, res, next) => {
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
app.get('/history', (req, res, next) => {
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
app.get('/history/:id', (req, res, next) => {
    const periodId = Number(req.params.id);
    if (!Number.isInteger(periodId) || periodId <= 0) {
        return res.status(404).send('Not found');
    }

    Promise.all([getPeriod(db, periodId), listStubsForPeriod(db, periodId)])
        .then(([period, stubs]) => {
            if (!period) return res.status(404).send('Not found');
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

// 404 handler
app.use((req, res) => {
    res.status(404).send('Not found');
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
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;

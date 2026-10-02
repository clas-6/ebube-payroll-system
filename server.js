const express = require('express');
const path = require('path');
const db = require('./database');

const { calculatePaycheck, PayrollInputError } = require('./src/services/payroll');
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

    db.all('SELECT * FROM employees ORDER BY id', [], (err, employees) => {
        if (err) return res.status(500).send('Database error');

        let payStubs;
        try {
            payStubs = employees.map((emp) => {
                let hours;
                if (emp.pay_type === 'hourly') {
                    hours = validateHours(toHours(hoursMap[emp.id]));
                }

                const { grossCents, taxCents, netCents } = calculatePaycheck({
                    payType: emp.pay_type,
                    rateCents: emp.rate_cents,
                    hours,
                });

                return {
                    name: emp.name,
                    payType: emp.pay_type,
                    grossPay: formatCents(grossCents),
                    taxes: formatCents(taxCents),
                    netPay: formatCents(netCents),
                };
            });
        } catch (calcErr) {
            if (
                calcErr instanceof ValidationError ||
                calcErr instanceof PayrollInputError
            ) {
                return res.status(400).render('payroll', {
                    employees: forDisplay(employees),
                    error: calcErr.message,
                });
            }
            return next(calcErr);
        }

        res.render('payroll-results', { payStubs });
    });
});

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

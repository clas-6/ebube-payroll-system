const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    db.all("SELECT * FROM employees", [], (err, rows) => {
        if (err) return res.status(500).send("Database error");
        res.render('index', { employees: rows });
    });
});

app.get('/add-employee', (req, res) => {
    res.render('add-employee');
});

app.post('/add-employee', (req, res) => {
    const { name, pay_type, rate } = req.body;
    db.run("INSERT INTO employees (name, pay_type, rate) VALUES (?, ?, ?)", 
        [name, pay_type, parseFloat(rate)], 
        (err) => {
            if (err) return res.status(500).send("Error saving employee");
            res.redirect('/');
        }
    );
});

app.get('/payroll', (req, res) => {
    db.all("SELECT * FROM employees", [], (err, employees) => {
        if (err) return res.status(500).send("Database error");
        res.render('payroll', { employees });
    });
});

app.post('/calculate-payroll', (req, res) => {
    const hoursData = req.body.hours || {}; 
    const taxRate = 0.15;
    
    db.all("SELECT * FROM employees", [], (err, employees) => {
        if (err) return res.status(500).send("Database error");
        
        const payStubs = employees.map(emp => {
            let grossPay = 0;
            
            if (emp.pay_type === 'salary') {
                grossPay = emp.rate / 26;
            } else if (emp.pay_type === 'hourly') {
                const hoursWorked = parseFloat(hoursData[emp.id] || 0);
                grossPay = emp.rate * hoursWorked;
            }
            
            const taxes = grossPay * taxRate;
            const netPay = grossPay - taxes;
            
            return {
                name: emp.name,
                payType: emp.pay_type,
                grossPay: grossPay.toFixed(2),
                taxes: taxes.toFixed(2),
                netPay: netPay.toFixed(2)
            };
        });
        
        res.render('payroll-results', { payStubs });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

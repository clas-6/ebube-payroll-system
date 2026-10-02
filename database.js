const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'payroll.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initSchema();
    }
});

/**
 * Create the schema and migrate legacy rows.
 *
 * Money is stored as INTEGER minor units (cents). The original MVP stored a
 * REAL `rate` (dollars), so we convert any existing rows once.
 */
function initSchema() {
    db.run(`CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        pay_type TEXT NOT NULL CHECK (pay_type IN ('hourly', 'salary')),
        rate_cents INTEGER NOT NULL DEFAULT 0 CHECK (rate_cents >= 0),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`, (err) => {
        if (err) {
            console.error('Error creating employees table', err.message);
            return;
        }
        migrateLegacyRateColumn();
    });
}

function migrateLegacyRateColumn() {
    db.all('PRAGMA table_info(employees)', [], (err, columns) => {
        if (err) {
            console.error('Error reading table info', err.message);
            return;
        }
        const names = columns.map((c) => c.name);
        if (!names.includes('rate_cents') && names.includes('rate')) {
            // Legacy schema: rename REAL dollars -> integer cents.
            db.serialize(() => {
                db.run('ALTER TABLE employees RENAME COLUMN rate TO rate_cents');
                db.run(
                    'UPDATE employees SET rate_cents = CAST(ROUND(rate_cents * 100) AS INTEGER)',
                    (updateErr) => {
                        if (updateErr) {
                            console.error('Error migrating rate values', updateErr.message);
                        } else {
                            console.log('Migrated legacy rate column to rate_cents.');
                        }
                    }
                );
            });
        } else if (names.includes('rate_cents') && names.includes('rate')) {
            console.warn('Both rate and rate_cents exist; manual migration required.');
        }
    });
}

module.exports = db;

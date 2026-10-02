const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { createSchema } = require('./src/db/schema');

const dbPath = path.resolve(__dirname, 'payroll.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        bootstrap();
    }
});

async function bootstrap() {
    await migrateLegacyRateColumn().catch((err) => {
        console.error('Legacy migration failed', err.message);
    });
    try {
        await createSchema(db);
        console.log('Schema ready.');
    } catch (err) {
        console.error('Error creating schema', err.message);
    }
}

/**
 * The MVP stored a REAL `rate` (dollars). Convert any such rows to the
 * integer-cent `rate_cents` column once, then leave the schema alone.
 */
function migrateLegacyRateColumn() {
    return new Promise((resolve) => {
        db.all('PRAGMA table_info(employees)', [], (err, columns) => {
            if (err || !columns) return resolve();
            const names = columns.map((c) => c.name);
            if (names.includes('rate') && !names.includes('rate_cents')) {
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
            }
            resolve();
        });
    });
}

module.exports = db;

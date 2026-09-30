# Ebube Payroll System MVP

This is a Minimum Viable Product (MVP) of a basic payroll system, built to manage employee records, track compensation types (hourly vs. salary), and calculate simple payroll summaries including gross pay, flat-rate taxes, and net pay.

## Tech Stack
*   **Backend:** Node.js with Express.js
*   **Database:** SQLite (local file-based db)
*   **Frontend Templating:** EJS (Embedded JavaScript templates)

## Core Features
1.  **Employee Management:** Add employees and specify their pay type (Salaried vs. Hourly) and pay rate.
2.  **Payroll Calculation:** 
    *   Hourly Employees: Input hours worked to calculate total pay.
    *   Salaried Employees: Automatically calculates bi-weekly pay (Annual Salary / 26).
3.  **Tax Deduction:** Applies a basic, flat 15% tax rate deduction for demonstration purposes.
4.  **Pay Stubs:** Displays a summary view of Gross Pay, Taxes, and Net Pay for all employees.

## Project Structure
*   `server.js`: The main Express server file containing all route definitions and business logic.
*   `database.js`: SQLite database initialization and schema setup.
*   `views/`: Contains EJS HTML templates for the frontend interfaces.
*   `payroll.db`: The local SQLite database file (created automatically upon running).

## Setup & Running Instructions
1.  Ensure you have Node.js installed.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the server:
    ```bash
    node server.js
    ```
4.  Open your browser and navigate to `http://localhost:3000`.

## AI Handover Notes
If an AI agent is reading this to continue development, here is the current context:
*   This is a pure MVP. The code focuses on simplicity over complex architecture.
*   The database consists of a single `employees` table: `id` (INTEGER PRIMARY KEY), `name` (TEXT), `pay_type` (TEXT: 'hourly' or 'salary'), and `rate` (REAL).
*   All routes (`/`, `/add-employee`, `/payroll`, `/calculate-payroll`) are defined linearly in `server.js`.
*   Future improvements should likely include:
    *   Extracting routes into separate controller files.
    *   Adding a `pay_periods` or `pay_stubs` table to save historical payroll runs (currently, `/calculate-payroll` just calculates and displays the data dynamically without saving the final stub).
    *   Adding more robust tax brackets rather than a flat 15% rate.

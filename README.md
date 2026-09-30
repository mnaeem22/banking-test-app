# Demo Bank – API and Database Testing Lab

A small banking web application for teaching how to test REST APIs (insert, update, get, delete)
and how to verify the results with SQL queries in MySQL Workbench. The API contains **intentional
defects** for students to find. The answer key is in `TEACHER_GUIDE.md` – keep that file away from students.

```
Browser UI  ──►  Express REST API (Node.js)  ──►  MySQL  ◄──  MySQL Workbench (students verify here)
```

## What is included

| Item | Purpose |
|---|---|
| Customer registration screen | Create, view, edit, delete, search and page through customers |
| Account creation screen | Open accounts, change the owner, delete, view balances |
| Transaction screen | Post deposits and withdrawals, view the ledger |
| Balance check screen | Lists accounts whose balance does not match the sum of their transactions |
| Request log (right side of the page) | Shows every request and response, with a "Copy as cURL" button |
| `postman/` | A Postman collection (36 requests, 47 tests) that describes the *correct* behaviour |
| `database/` | `schema.sql`, `seed.sql`, and `setup.js` |

## Requirements

* Node.js 18 or newer
* MySQL 8 (MariaDB 10.5+ also works) and MySQL Workbench

## Setup (about 5 minutes)

```bash
cd banking-test-app
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

Open `.env` and set `DB_USER` and `DB_PASSWORD` for your MySQL server. Then:

```bash
npm run setup               # creates DemoBankingDB, the 3 tables, and the sample data
npm start                   # http://localhost:3000
```

Alternative to `npm run setup`: open `database/schema.sql` and then `database/seed.sql` in
MySQL Workbench and run them.

> **Note on your original script:** it created `DemoBankingDB` but then ran `USE BankingDB;`, which fails.
> The scripts here use `DemoBankingDB` everywhere. If you prefer another name, change `DB_NAME` in `.env`
> and replace the name in the `.sql` files.

## Connecting from MySQL Workbench

Use the same host, port, user and password as in `.env`, open the `DemoBankingDB` schema and run
queries such as:

```sql
SELECT * FROM Customers;
SELECT * FROM Accounts;
SELECT * FROM Transactions ORDER BY TransactionID DESC;
```

## The two modes

The pill at the top of the page shows the mode. Click it to switch (no restart needed).

* **Defects: on** (default) – the version students test.
* **Defects: off** – the correct reference behaviour. Useful for showing what a good response looks like,
  and for checking that your own test cases pass against a correct implementation.

To start in reference mode, set `ENABLE_BUGS=false` in `.env`.

**Reset sample data** (top right) empties the three tables and reloads the sample data. Use it between exercises.

## API summary

| Method | Path | Notes |
|---|---|---|
| GET | `/api/customers?page=&limit=&city=` | Paged list, optional city filter |
| GET / PUT / DELETE | `/api/customers/{id}` | |
| POST | `/api/customers` | `{ "name", "email", "city" }` |
| GET | `/api/accounts?customerId=` | |
| GET / PUT / DELETE | `/api/accounts/{id}` | PUT changes the owner: `{ "customerId" }` |
| POST | `/api/accounts` | `{ "customerId", "balance" }` |
| GET | `/api/transactions?accountId=` | |
| GET | `/api/transactions/{id}` | |
| POST | `/api/transactions` | `{ "accountId", "type": "DEPOSIT" or "WITHDRAWAL", "amount" }` |
| GET | `/api/reports/reconciliation` | Accounts where balance ≠ sum of transactions |
| POST | `/api/admin/reset`, `/api/admin/mode` | Teacher helpers |

The `Transactions.Amount` column is **signed** (withdrawals are stored as negative numbers), while the API
takes a positive `amount` plus a `type`. Students should notice this when comparing API and database.

## Postman

Import `postman/DemoBank.postman_collection.json`. Click **Reset sample data** in the page (or send the
"Reset sample data" request), then run the collection. The tests describe the *correct* behaviour, so with
defects on, 22 of the 47 tests fail – each failure points at a defect. With defects off, all 47 pass.

## Troubleshooting

* **"Cannot connect to MySQL"** when starting – check `.env` and that MySQL is running.
* **`ER_ACCESS_DENIED_ERROR`** – wrong user or password in `.env`.
* **Port 3000 in use** – set `PORT=3001` in `.env`.
* The page loads but shows "The API cannot reach the database" – run `npm run setup`.

## Safety note

This app is deliberately insecure (SQL injection, leaked SQL errors, no authentication).
Run it only on a classroom machine or `localhost`, never on a public server.

# Teacher guide – answer key and lesson plan  (do not share with students)

## 1. Suggested 90-minute flow

| Time | Activity |
|---|---|
| 0–10 | Architecture: UI → API → database. Show the request log and the Workbench side by side. |
| 10–30 | **Happy path.** Students create a customer, open an account, post a deposit and a withdrawal in the UI. After each step they confirm the row in Workbench (queries in section 3). |
| 30–50 | **CRUD by API.** Same operations from Postman: POST, GET, PUT, DELETE. Students write status-code and body assertions. |
| 50–75 | **Negative testing.** Empty fields, bad e-mail, duplicates, negative and zero amounts, unknown IDs, overdraft. Students record *expected* vs *actual*. |
| 75–90 | **Database verification.** Balance check screen, reconciliation SQL, and a debrief where you reveal the defects they missed (flip **Defects: off** and rerun their tests). |

Teaching point to repeat: **the API response is a claim; the database is the evidence.**
D16 is the best example – the response says the balance changed, the database says it did not.

## 2. Defect catalogue

Each defect is marked `DEFECT Dnn` in `server.js`. "Correct behaviour" is what the app does with
**Defects: off**.

### Customers

| ID | Where | What happens with defects on | Correct behaviour | How students can find it |
|---|---|---|---|---|
| D01 | POST/PUT `/customers` | Duplicate e-mail accepted (the table has no UNIQUE constraint) | 409 Conflict | Register the same e-mail twice; `SELECT Email, COUNT(*) FROM Customers GROUP BY Email HAVING COUNT(*) > 1;` |
| D02 | POST/PUT `/customers` | E-mail format not checked (`abc` is saved) | 400 with a field message | Send `not-an-email` |
| D03 | POST/PUT `/customers` | Name/city of only spaces accepted, no trimming, no length limit. A 101-character name causes a raw database error (500) | 400 with a field message; values trimmed | Send `"   "` and a very long name; in Workbench `SELECT CONCAT('[', NAME, ']') ...` shows the spaces |
| D04 | POST `/customers` | Returns **200** | 201 Created + Location header | Check the status code |
| D05 | PUT `/customers/{id}` | Unknown id returns **200** with a success body; nothing changed in the DB | 404 | PUT `/customers/99999`; compare with `SELECT` |
| D06 | DELETE `/customers/{id}` | Customer with accounts: raw SQL foreign-key error, **500**. Unknown id: 200 "Customer deleted" | 409 / 404, and 204 on success | Delete customer 1, then 99999 |
| D07 | GET `/customers?city=` | **SQL injection**: `city=' OR '1'='1` returns every customer; other input produces SQL errors that show the query | Parameterised query | `city=' OR '1'='1`; `city='` (quote) |
| D08 | GET `/customers?page=&limit=` | Off-by-one: page 1 skips the first `limit` rows, so the first customers never appear | `OFFSET = (page-1)*limit` | Compare page 1 with `SELECT * FROM Customers ORDER BY CustomerID LIMIT 3;` |
| D09 | GET `/customers/{id}` | Unknown id returns **200 with `{}`** | 404 | GET `/customers/99999` |

### Accounts

| ID | Where | What happens with defects on | Correct behaviour | How students can find it |
|---|---|---|---|---|
| D11 | POST `/accounts` | Negative opening balance accepted | 400 | `balance: -50` |
| D12 | POST `/accounts`, POST `/transactions` | Unknown `customerId` / `accountId` gives a raw foreign-key error, **500** | 422 / 404 with a friendly message | `customerId: 99999` |
| D13 | POST `/accounts` | More than 2 decimals accepted; MySQL silently rounds (`10.999` is stored as `11.00`) while the response echoes `10.999` | 400 | `balance: 10.999`, then `SELECT` |
| D20 | DELETE `/accounts/{id}` | No checks. Account with history: raw FK error 500. Account holding money but no history (see D21): deleted, money disappears | 409 unless balance is 0 and there is no history | Delete account 8 (has history) and an account created with a balance |
| D21 | POST `/accounts` | Opening balance is **not** recorded as a transaction | An opening-deposit transaction is inserted in the same DB transaction | `SELECT * FROM Transactions WHERE AccountID = <new id>;` returns nothing; Balance check shows a difference |
| D22 | PUT `/accounts/{id}` | `balance` can be overwritten directly, with no transaction record | 400 – balance only changes through transactions | PUT `{ "customerId": 1, "balance": 999999 }` |

### Transactions

| ID | Where | What happens with defects on | Correct behaviour | How students can find it |
|---|---|---|---|---|
| D14 | POST `/transactions` | Amount `0` and negative amounts accepted (a negative deposit reduces the balance) | 400: amount must be > 0 | `amount: 0`, `amount: -100` |
| D15 | POST `/transactions` | Withdrawal larger than the balance accepted; balance goes negative | 422 Insufficient funds | Withdraw 5000 from account 4 (balance 750) |
| D16 | POST `/transactions` | **Amount over 10,000: the transaction row is inserted but the account balance is not updated, while the response reports a new `balanceAfter`** | Both updated together | Deposit 20000 into account 4; compare the response, `SELECT Balance`, and the Balance check screen |
| D17 | POST `/transactions` | Unknown `type` (e.g. `TRANSFER`, `xyz`) treated as a deposit | 400 | `type: "TRANSFER"` |
| D18 | POST `/transactions` | Race condition: the balance is read, calculated in code and written back, without a DB transaction or lock. Two simultaneous requests lose an update | `UPDATE ... SET Balance = Balance + ?` inside a transaction with `FOR UPDATE` | Advanced: fire 20 parallel 10.00 deposits (Postman runner, or `xargs -P`) and compare with `SUM(Amount)` |
| D19 | POST `/transactions` | Money calculated with JavaScript floating point. `10.005` gives `balanceAfter: 5810.005` while the DB stores rounded values, so response and database differ by fractions of a cent | Two-decimal validation and calculation in SQL DECIMAL | Deposit `10.005`, compare the response with `SELECT` |
| D23 | PUT `/transactions/{id}` | The endpoint exists and edits the amount, but the balance is not adjusted | 405 – transactions are immutable | PUT `{ "amount": 1 }`, run Balance check |
| D24 | DELETE `/transactions/{id}` | The endpoint exists and deletes the row, but the balance is not reversed | 405 | DELETE a transaction, run Balance check |

### Cross-cutting

| ID | What happens with defects on | Correct behaviour |
|---|---|---|
| D10 | Any unexpected error returns the raw MySQL message, error code and SQL text in the response body | Generic message, details only in the server log |

Also worth pointing out (not defects, but design discussion): passwords/authentication are absent, there
is no rate limiting, and the schema has no `UNIQUE(Email)`, `CHECK(Amount <> 0)` or timestamp columns –
ask students which database constraints would have prevented D01, D11 and D14 in the first place.

## 3. Verification queries for students

```sql
-- Latest rows
SELECT * FROM Customers    ORDER BY CustomerID DESC LIMIT 5;
SELECT * FROM Accounts     ORDER BY AccountID DESC  LIMIT 5;
SELECT * FROM Transactions ORDER BY TransactionID DESC LIMIT 10;

-- Duplicate e-mails (D01)
SELECT Email, COUNT(*) AS copies FROM Customers GROUP BY Email HAVING COUNT(*) > 1;

-- Whitespace and format problems (D02, D03)
SELECT CustomerID, CONCAT('[', NAME, ']') AS name_with_brackets, Email
FROM Customers
WHERE TRIM(NAME) = '' OR NAME <> TRIM(NAME) OR Email NOT LIKE '%_@_%._%';

-- Negative balances (D11, D15)
SELECT * FROM Accounts WHERE Balance < 0;

-- Zero or nonsensical amounts (D14)
SELECT * FROM Transactions WHERE Amount = 0;

-- Balance vs ledger (D16, D21, D22, D23, D24, D18, D19)
SELECT a.AccountID, a.Balance,
       COALESCE(SUM(t.Amount), 0)              AS ledger_total,
       a.Balance - COALESCE(SUM(t.Amount), 0)  AS difference
FROM Accounts a
LEFT JOIN Transactions t ON t.AccountID = a.AccountID
GROUP BY a.AccountID, a.Balance
HAVING difference <> 0;

-- Customers with no accounts / accounts with no transactions
SELECT c.* FROM Customers c LEFT JOIN Accounts a ON a.CustomerID = c.CustomerID WHERE a.AccountID IS NULL;
SELECT a.* FROM Accounts  a LEFT JOIN Transactions t ON t.AccountID = a.AccountID WHERE t.TransactionID IS NULL;

-- Customer summary (join practice)
SELECT c.CustomerID, c.NAME, COUNT(DISTINCT a.AccountID) AS accounts, COALESCE(SUM(a.Balance), 0) AS total_balance
FROM Customers c LEFT JOIN Accounts a ON a.CustomerID = c.CustomerID
GROUP BY c.CustomerID, c.NAME;
```

## 4. Sample data (after Reset)

| Customer | Accounts | Notes |
|---|---|---|
| 1 Ayesha Khan | 1 (5,800.00), 2 (1,749.50) | Delete blocked (has accounts) |
| 2 Bilal Ahmed | 3 (11,299.25) | |
| 3 Sara Malik | 4 (750.00) | Good for overdraft tests |
| 4 Omar Farooq | 5 (3,000.00) | |
| 5 Hina Siddiqui | 6 (10,250.25) | |
| 6 Daniyal Shah | 7 (0.00, no transactions) | Account 7 can be deleted even in reference mode |
| 7 Fatima Zahra | 8 (100.00) | |
| 8 Usman Tariq | none | Customer 8 can be deleted even in reference mode |

Customers 1–5 are spread over Karachi, Lahore, Hyderabad and Islamabad for city-filter tests.

## 5. Student worksheet ideas

1. For every endpoint, list the success case and at least three failure cases with the expected status code.
2. Write a Postman test that fails when a defect is present, and passes with **Defects: off**.
3. For each POST/PUT/DELETE: record *response*, *UI*, and *database row*. Do all three agree?
4. Find three defects that can only be seen by looking at the database, not at the response (D01, D13, D16, D21).
5. Write the SQL that proves a defect and paste it into your bug report, with steps to reproduce.
6. Propose a database constraint that would have prevented each of D01, D11, D14.

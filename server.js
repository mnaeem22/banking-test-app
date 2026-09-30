'use strict';
/**
 * Banking Test Application - REST API + static web UI
 *
 * The API can run in two modes:
 *   BUGS = true   -> contains intentional defects (for student exercises, see TEACHER_GUIDE.md)
 *   BUGS = false  -> reference behaviour (what a correct implementation looks like)
 *
 * Every place that behaves differently is marked with a "DEFECT Dnn" comment.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'DemoBankingDB',
};
const PORT = Number(process.env.PORT || 3000);
let BUGS = String(process.env.ENABLE_BUGS ?? 'true').toLowerCase() !== 'false';

const pool = mysql.createPool({
  ...DB,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true, // return DECIMAL columns as numbers instead of strings
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple console access log (handy to show students what the server receives)
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - t0} ms)`);
    }
  });
  next();
});

// ---------------------------------------------------------------- helpers
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const isId = (v) => (typeof v === 'number' ? Number.isInteger(v) : /^\d+$/.test(String(v))) && Number(v) > 0;
const isMoney = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-7;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const round2 = (n) => Math.round(n * 100) / 100;
const bad = (res, message, details) =>
  res.status(400).json({ error: message, ...(details ? { details } : {}) });

async function withTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Columns are aliased in every query so the result keys do not depend on how the table's column names are capitalised
const CUSTOMER_COLS = 'CustomerID, NAME AS CustomerName, Email, City';
const toCustomer = (r) => ({ customerId: r.CustomerID, name: r.CustomerName, email: r.Email, city: r.City });
const toAccount = (r) => ({
  accountId: r.AccountID,
  customerId: r.CustomerID,
  customerName: r.CustomerName ?? null,
  balance: r.Balance,
});
const toTxn = (r) => ({
  transactionId: r.TransactionID,
  accountId: r.AccountID,
  type: r.Amount >= 0 ? 'DEPOSIT' : 'WITHDRAWAL', // the table stores a signed amount
  amount: round2(Math.abs(r.Amount)),
});
const ACCOUNT_SELECT =
  'SELECT a.AccountID, a.CustomerID, a.Balance, c.NAME AS CustomerName FROM Accounts a LEFT JOIN Customers c ON c.CustomerID = a.CustomerID';

function validateCustomer(b) {
  const errors = [];
  const value = {};
  const rules = [['name', 2, 100], ['email', 5, 150], ['city', 2, 50]];
  for (const [field, min, max] of rules) {
    const v = b[field];
    if (typeof v !== 'string' || v.trim() === '') {
      errors.push({ field, message: `${field} is required` });
      continue;
    }
    value[field] = v.trim();
    if (value[field].length < min || value[field].length > max) {
      errors.push({ field, message: `${field} must be between ${min} and ${max} characters` });
    }
  }
  if (value.email && !EMAIL.test(value.email)) {
    errors.push({ field: 'email', message: 'email format is invalid' });
  }
  return { errors, value };
}

// ---------------------------------------------------------------- admin / health
app.get('/api/health', h(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: DB.database });
}));

app.get('/api/admin/mode', (req, res) => res.json({ bugs: BUGS }));
app.post('/api/admin/mode', (req, res) => {
  if (typeof (req.body || {}).bugs !== 'boolean') return bad(res, 'Send {"bugs": true|false}');
  BUGS = req.body.bugs;
  res.json({ bugs: BUGS });
});

app.post('/api/admin/reset', h(async (req, res) => {
  const sql = fs.readFileSync(path.join(__dirname, 'database', 'seed.sql'), 'utf8').replace(/DemoBankingDB/g, DB.database);
  const conn = await mysql.createConnection({ ...DB, multipleStatements: true });
  try {
    await conn.query(sql);
  } finally {
    await conn.end();
  }
  res.json({ message: 'Sample data restored' });
}));

// ================================================================ CUSTOMERS
app.get('/api/customers', h(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const city = req.query.city;
  if (!BUGS && (page < 1 || limit < 1 || limit > 100)) {
    return bad(res, 'page must be >= 1 and limit must be between 1 and 100');
  }
  // DEFECT D08: off-by-one in pagination, page 1 skips the first "limit" rows
  const offset = BUGS ? page * limit : (page - 1) * limit;

  let where = '';
  const params = [];
  if (city) {
    if (BUGS) {
      where = `WHERE City = '${city}'`; // DEFECT D07: SQL built by string concatenation (SQL injection)
    } else {
      where = 'WHERE City = ?';
      params.push(city);
    }
  }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM Customers ${where}`, params);
  if (req.query.all === 'true') {
    // The web page uses ?all=true to show every customer at once (no paging, unaffected by D08)
    const [all] = await pool.query(`SELECT ${CUSTOMER_COLS} FROM Customers ${where} ORDER BY CustomerID`, params);
    return res.json({ page: 1, limit: total, total, data: all.map(toCustomer) });
  }
  const [rows] = await pool.query(
    `SELECT ${CUSTOMER_COLS} FROM Customers ${where} ORDER BY CustomerID LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  res.json({ page, limit, total, data: rows.map(toCustomer) });
}));

app.get('/api/customers/:id', h(async (req, res) => {
  const { id } = req.params;
  if (!BUGS && !isId(id)) return bad(res, 'id must be a positive integer');
  const [rows] = await pool.query(`SELECT ${CUSTOMER_COLS} FROM Customers WHERE CustomerID = ?`, [id]);
  if (!rows.length) {
    // DEFECT D09: unknown id answers 200 with an empty object instead of 404
    return BUGS ? res.status(200).json({}) : res.status(404).json({ error: 'Customer not found' });
  }
  res.json(toCustomer(rows[0]));
}));

app.post('/api/customers', h(async (req, res) => {
  const b = req.body || {};
  let v;
  if (BUGS) {
    // DEFECT D01/D02/D03: only checks "not empty" - no trim, no e-mail format, no length, no duplicate check
    if (!b.name || !b.email || !b.city) return bad(res, 'name, email and city are required');
    v = { name: b.name, email: b.email, city: b.city };
  } else {
    const r = validateCustomer(b);
    if (r.errors.length) return res.status(400).json({ error: 'Validation failed', details: r.errors });
    v = r.value;
    const [dup] = await pool.query('SELECT 1 FROM Customers WHERE LOWER(Email) = LOWER(?)', [v.email]);
    if (dup.length) return res.status(409).json({ error: 'A customer with this email already exists' });
  }
  const [r] = await pool.query('INSERT INTO Customers (NAME, Email, City) VALUES (?, ?, ?)', [v.name, v.email, v.city]);
  // DEFECT D04: a created resource should answer 201, this answers 200
  res.status(BUGS ? 200 : 201).location(`/api/customers/${r.insertId}`).json({ customerId: r.insertId, ...v });
}));

app.put('/api/customers/:id', h(async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  if (BUGS) {
    if (!b.name || !b.email || !b.city) return bad(res, 'name, email and city are required');
    await pool.query('UPDATE Customers SET NAME = ?, Email = ?, City = ? WHERE CustomerID = ?', [b.name, b.email, b.city, id]);
    // DEFECT D05: answers 200 "success" even when the customer does not exist (0 rows updated)
    return res.json({ customerId: Number(id), name: b.name, email: b.email, city: b.city });
  }
  if (!isId(id)) return bad(res, 'id must be a positive integer');
  const r = validateCustomer(b);
  if (r.errors.length) return res.status(400).json({ error: 'Validation failed', details: r.errors });
  const [exists] = await pool.query('SELECT 1 FROM Customers WHERE CustomerID = ?', [id]);
  if (!exists.length) return res.status(404).json({ error: 'Customer not found' });
  const [dup] = await pool.query('SELECT 1 FROM Customers WHERE LOWER(Email) = LOWER(?) AND CustomerID <> ?', [r.value.email, id]);
  if (dup.length) return res.status(409).json({ error: 'A customer with this email already exists' });
  await pool.query('UPDATE Customers SET NAME = ?, Email = ?, City = ? WHERE CustomerID = ?', [r.value.name, r.value.email, r.value.city, id]);
  res.json({ customerId: Number(id), ...r.value });
}));

app.delete('/api/customers/:id', h(async (req, res) => {
  const { id } = req.params;
  if (BUGS) {
    // DEFECT D06: no checks. Customer with accounts -> raw SQL foreign-key error leaks out as a 500.
    // Unknown id -> "deleted" message with 200.
    await pool.query('DELETE FROM Customers WHERE CustomerID = ?', [id]);
    return res.status(200).json({ message: 'Customer deleted' });
  }
  if (!isId(id)) return bad(res, 'id must be a positive integer');
  const [exists] = await pool.query('SELECT 1 FROM Customers WHERE CustomerID = ?', [id]);
  if (!exists.length) return res.status(404).json({ error: 'Customer not found' });
  const [accts] = await pool.query('SELECT 1 FROM Accounts WHERE CustomerID = ? LIMIT 1', [id]);
  if (accts.length) return res.status(409).json({ error: 'Customer still has accounts and cannot be deleted' });
  await pool.query('DELETE FROM Customers WHERE CustomerID = ?', [id]);
  res.status(204).end();
}));

// ================================================================ ACCOUNTS
app.get('/api/accounts', h(async (req, res) => {
  const { customerId } = req.query;
  if (customerId !== undefined && !isId(customerId)) return bad(res, 'customerId must be a positive integer');
  const [rows] = customerId
    ? await pool.query(`${ACCOUNT_SELECT} WHERE a.CustomerID = ? ORDER BY a.AccountID`, [customerId])
    : await pool.query(`${ACCOUNT_SELECT} ORDER BY a.AccountID`);
  res.json(rows.map(toAccount));
}));

app.get('/api/accounts/:id', h(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return bad(res, 'id must be a positive integer');
  const [rows] = await pool.query(`${ACCOUNT_SELECT} WHERE a.AccountID = ?`, [id]);
  if (!rows.length) return res.status(404).json({ error: 'Account not found' });
  res.json(toAccount(rows[0]));
}));

app.post('/api/accounts', h(async (req, res) => {
  const b = req.body || {};
  if (BUGS) {
    if (b.customerId === undefined) return bad(res, 'customerId is required');
    const balance = b.balance ?? 0;
    // DEFECT D11: negative opening balance accepted
    // DEFECT D12: unknown customerId -> raw foreign-key error as 500 instead of a friendly 4xx
    // DEFECT D13: more than 2 decimals accepted, MySQL silently rounds them
    // DEFECT D21: opening balance is NOT recorded as a transaction, so ledger and balance disagree
    const [r] = await pool.query('INSERT INTO Accounts (CustomerID, Balance) VALUES (?, ?)', [b.customerId, balance]);
    return res.status(201).json({ accountId: r.insertId, customerId: b.customerId, balance });
  }
  const errors = [];
  if (!isId(b.customerId)) errors.push({ field: 'customerId', message: 'customerId must be a positive integer' });
  const balance = b.balance === undefined ? 0 : b.balance;
  if (!isMoney(balance) || balance < 0) {
    errors.push({ field: 'balance', message: 'balance must be a number >= 0 with at most 2 decimals' });
  } else if (balance > 9999999999999.99) {
    errors.push({ field: 'balance', message: 'balance is too large' });
  }
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  const result = await withTx(async (c) => {
    const [cust] = await c.query('SELECT NAME AS CustomerName FROM Customers WHERE CustomerID = ?', [b.customerId]);
    if (!cust.length) return { status: 422, body: { error: 'Customer does not exist' } };
    const [ins] = await c.query('INSERT INTO Accounts (CustomerID, Balance) VALUES (?, ?)', [b.customerId, balance]);
    if (balance > 0) {
      await c.query('INSERT INTO Transactions (AccountID, Amount) VALUES (?, ?)', [ins.insertId, balance]); // opening deposit
    }
    return {
      status: 201,
      body: { accountId: ins.insertId, customerId: Number(b.customerId), customerName: cust[0].CustomerName, balance },
      location: `/api/accounts/${ins.insertId}`,
    };
  });
  if (result.location) res.location(result.location);
  res.status(result.status).json(result.body);
}));

app.put('/api/accounts/:id', h(async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  if (BUGS) {
    const fields = [];
    const vals = [];
    if (b.customerId !== undefined) { fields.push('CustomerID = ?'); vals.push(b.customerId); }
    // DEFECT D22: balance can be overwritten directly, bypassing the transaction ledger
    if (b.balance !== undefined) { fields.push('Balance = ?'); vals.push(b.balance); }
    if (!fields.length) return bad(res, 'Send customerId and/or balance');
    await pool.query(`UPDATE Accounts SET ${fields.join(', ')} WHERE AccountID = ?`, [...vals, id]);
    const [rows] = await pool.query(`${ACCOUNT_SELECT} WHERE a.AccountID = ?`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Account not found' });
    return res.json(toAccount(rows[0]));
  }
  if (!isId(id)) return bad(res, 'id must be a positive integer');
  if ('balance' in b) return bad(res, 'balance cannot be changed directly, post a transaction instead');
  if (!isId(b.customerId)) return res.status(400).json({ error: 'Validation failed', details: [{ field: 'customerId', message: 'customerId must be a positive integer' }] });
  const [acct] = await pool.query('SELECT 1 FROM Accounts WHERE AccountID = ?', [id]);
  if (!acct.length) return res.status(404).json({ error: 'Account not found' });
  const [cust] = await pool.query('SELECT 1 FROM Customers WHERE CustomerID = ?', [b.customerId]);
  if (!cust.length) return res.status(422).json({ error: 'Customer does not exist' });
  await pool.query('UPDATE Accounts SET CustomerID = ? WHERE AccountID = ?', [b.customerId, id]);
  const [rows] = await pool.query(`${ACCOUNT_SELECT} WHERE a.AccountID = ?`, [id]);
  res.json(toAccount(rows[0]));
}));

app.delete('/api/accounts/:id', h(async (req, res) => {
  const { id } = req.params;
  if (BUGS) {
    // DEFECT D20: no checks. Account with history -> raw FK error 500; account with money but no history -> deleted, money vanishes.
    await pool.query('DELETE FROM Accounts WHERE AccountID = ?', [id]);
    return res.status(200).json({ message: 'Account deleted' });
  }
  if (!isId(id)) return bad(res, 'id must be a positive integer');
  const [rows] = await pool.query('SELECT Balance FROM Accounts WHERE AccountID = ?', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Account not found' });
  if (rows[0].Balance !== 0) return res.status(409).json({ error: 'Account balance must be 0 before it can be deleted' });
  const [txns] = await pool.query('SELECT 1 FROM Transactions WHERE AccountID = ? LIMIT 1', [id]);
  if (txns.length) return res.status(409).json({ error: 'Account has transaction history and cannot be deleted' });
  await pool.query('DELETE FROM Accounts WHERE AccountID = ?', [id]);
  res.status(204).end();
}));

// ================================================================ TRANSACTIONS
app.get('/api/transactions', h(async (req, res) => {
  const { accountId } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  if (accountId !== undefined && !isId(accountId)) return bad(res, 'accountId must be a positive integer');
  const [rows] = accountId
    ? await pool.query('SELECT * FROM Transactions WHERE AccountID = ? ORDER BY TransactionID DESC LIMIT ?', [accountId, limit])
    : await pool.query('SELECT * FROM Transactions ORDER BY TransactionID DESC LIMIT ?', [limit]);
  res.json(rows.map(toTxn));
}));

app.get('/api/transactions/:id', h(async (req, res) => {
  const { id } = req.params;
  if (!isId(id)) return bad(res, 'id must be a positive integer');
  const [rows] = await pool.query('SELECT * FROM Transactions WHERE TransactionID = ?', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Transaction not found' });
  res.json(toTxn(rows[0]));
}));

app.post('/api/transactions', h(async (req, res) => {
  const b = req.body || {};
  if (BUGS) {
    if (b.accountId === undefined || b.amount === undefined) return bad(res, 'accountId and amount are required');
    const amount = Number(b.amount); // DEFECT D14: 0 and negative amounts accepted
    const isWithdrawal = String(b.type).toUpperCase() === 'WITHDRAWAL'; // DEFECT D17: any unknown type is treated as a deposit
    const signed = isWithdrawal ? -amount : amount;
    // DEFECT D18: read-modify-write without a DB transaction or row lock (lost updates under concurrency)
    // DEFECT D15: no overdraft check - balance can go negative
    // DEFECT D12: unknown accountId -> raw foreign-key error 500
    const [rows] = await pool.query('SELECT Balance FROM Accounts WHERE AccountID = ?', [b.accountId]);
    const current = rows.length ? rows[0].Balance : 0;
    const [ins] = await pool.query('INSERT INTO Transactions (AccountID, Amount) VALUES (?, ?)', [b.accountId, signed]);
    const newBalance = current + signed; // DEFECT D19: floating point arithmetic in JavaScript instead of DECIMAL in SQL
    // DEFECT D16: amounts above 10,000 are saved as a transaction but the balance is NOT updated,
    // while the response below still reports the new balance
    if (Math.abs(amount) <= 10000) {
      await pool.query('UPDATE Accounts SET Balance = ? WHERE AccountID = ?', [newBalance, b.accountId]);
    }
    return res.status(201).json({
      transactionId: ins.insertId,
      accountId: b.accountId,
      type: isWithdrawal ? 'WITHDRAWAL' : 'DEPOSIT',
      amount: Math.abs(amount),
      balanceAfter: newBalance,
    });
  }

  const errors = [];
  if (!isId(b.accountId)) errors.push({ field: 'accountId', message: 'accountId must be a positive integer' });
  const type = typeof b.type === 'string' ? b.type.toUpperCase() : null;
  if (!['DEPOSIT', 'WITHDRAWAL'].includes(type)) errors.push({ field: 'type', message: 'type must be DEPOSIT or WITHDRAWAL' });
  if (!isMoney(b.amount) || b.amount <= 0) {
    errors.push({ field: 'amount', message: 'amount must be a number greater than 0 with at most 2 decimals' });
  } else if (b.amount > 1000000) {
    errors.push({ field: 'amount', message: 'amount exceeds the limit of 1,000,000 per transaction' });
  }
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  const result = await withTx(async (c) => {
    const [rows] = await c.query('SELECT Balance FROM Accounts WHERE AccountID = ? FOR UPDATE', [b.accountId]);
    if (!rows.length) return { status: 404, body: { error: 'Account not found' } };
    const signed = type === 'WITHDRAWAL' ? -b.amount : b.amount;
    if (Math.round((rows[0].Balance + signed) * 100) < 0) {
      return { status: 422, body: { error: 'Insufficient funds', balance: rows[0].Balance, requested: b.amount } };
    }
    const [ins] = await c.query('INSERT INTO Transactions (AccountID, Amount) VALUES (?, ?)', [b.accountId, signed]);
    await c.query('UPDATE Accounts SET Balance = Balance + ? WHERE AccountID = ?', [signed, b.accountId]);
    const [[after]] = await c.query('SELECT Balance FROM Accounts WHERE AccountID = ?', [b.accountId]);
    return {
      status: 201,
      body: { transactionId: ins.insertId, accountId: Number(b.accountId), type, amount: b.amount, balanceAfter: after.Balance },
      location: `/api/transactions/${ins.insertId}`,
    };
  });
  if (result.location) res.location(result.location);
  res.status(result.status).json(result.body);
}));

app.put('/api/transactions/:id', h(async (req, res) => {
  if (!BUGS) {
    return res.status(405).set('Allow', 'GET, POST').json({ error: 'Transactions are immutable and cannot be edited' });
  }
  // DEFECT D23: transaction amount can be edited, but the account balance is not adjusted
  const { amount } = req.body || {};
  if (amount === undefined) return bad(res, 'amount is required');
  const [rows] = await pool.query('SELECT * FROM Transactions WHERE TransactionID = ?', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Transaction not found' });
  const signed = rows[0].Amount < 0 ? -Math.abs(Number(amount)) : Math.abs(Number(amount));
  await pool.query('UPDATE Transactions SET Amount = ? WHERE TransactionID = ?', [signed, req.params.id]);
  res.json(toTxn({ ...rows[0], Amount: signed }));
}));

app.delete('/api/transactions/:id', h(async (req, res) => {
  if (!BUGS) {
    return res.status(405).set('Allow', 'GET, POST').json({ error: 'Transactions are immutable and cannot be deleted' });
  }
  // DEFECT D24: transaction can be deleted, the account balance is not reversed
  await pool.query('DELETE FROM Transactions WHERE TransactionID = ?', [req.params.id]);
  res.status(200).json({ message: 'Transaction deleted' });
}));

// ================================================================ REPORTS
app.get('/api/reports/reconciliation', h(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT a.AccountID, c.NAME AS CustomerName, a.Balance,
           COALESCE(SUM(t.Amount), 0) AS LedgerTotal
    FROM Accounts a
    JOIN Customers c ON c.CustomerID = a.CustomerID
    LEFT JOIN Transactions t ON t.AccountID = a.AccountID
    GROUP BY a.AccountID, c.NAME, a.Balance
    HAVING ABS(a.Balance - COALESCE(SUM(t.Amount), 0)) > 0.004
    ORDER BY a.AccountID`);
  res.json(rows.map((r) => ({
    accountId: r.AccountID,
    customerName: r.CustomerName,
    balance: r.Balance,
    ledgerTotal: r.LedgerTotal,
    difference: round2(r.Balance - r.LedgerTotal),
  })));
}));

// ---------------------------------------------------------------- fallbacks
app.use('/api', (req, res) => res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });
  console.error(err);
  if (BUGS) {
    // DEFECT D10: internal details (SQL text, error codes) are leaked to the client
    return res.status(500).json({ error: err.message, code: err.code, sql: err.sql });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ---------------------------------------------------------------- start
(async () => {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error(`\nCannot connect to MySQL (${DB.user}@${DB.host}:${DB.port}/${DB.database}): ${err.message}`);
    console.error('Check your .env file and run "npm run setup" once to create the database.\n');
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`Banking Test App running at http://localhost:${PORT}`);
    console.log(`Defects are ${BUGS ? 'ON' : 'OFF'} (change in the page header or with ENABLE_BUGS in .env)`);
  });
})();

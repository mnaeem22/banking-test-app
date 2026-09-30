-- ============================================
-- Sample data. Safe to run repeatedly: it empties the tables first.
-- Every account balance equals the sum of its transactions
-- (this is the rule the "Balance check" screen verifies).
-- ============================================
USE DemoBankingDB;

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE Transactions;
TRUNCATE TABLE Accounts;
TRUNCATE TABLE Customers;
SET FOREIGN_KEY_CHECKS = 1;

INSERT INTO Customers (NAME, Email, City) VALUES
 ('Ayesha Khan',    'ayesha.khan@example.com',    'Karachi'),
 ('Bilal Ahmed',    'bilal.ahmed@example.com',    'Lahore'),
 ('Sara Malik',     'sara.malik@example.com',     'Hyderabad'),
 ('Omar Farooq',    'omar.farooq@example.com',    'Islamabad'),
 ('Hina Siddiqui',  'hina.siddiqui@example.com',  'Karachi'),
 ('Daniyal Shah',   'daniyal.shah@example.com',   'Hyderabad'),
 ('Fatima Zahra',   'fatima.zahra@example.com',   'Lahore'),
 ('Usman Tariq',    'usman.tariq@example.com',    'Multan');   -- has no account: safe to delete

INSERT INTO Accounts (CustomerID, Balance) VALUES
 (1,  5800.00),   -- 1
 (1,  1749.50),   -- 2
 (2, 11299.25),   -- 3
 (3,   750.00),   -- 4
 (4,  3000.00),   -- 5
 (5, 10250.25),   -- 6
 (6,     0.00),   -- 7  no transactions: safe to delete
 (7,   100.00);   -- 8

INSERT INTO Transactions (AccountID, Amount) VALUES
 (1,  5000.00), (1,  1500.00), (1,  -700.00),
 (2,  2000.00), (2,  -250.50),
 (3, 10000.00), (3,  2500.00), (3, -1200.75),
 (4,   750.00),
 (5,  3200.00), (5,  -200.00),
 (6, 15000.00), (6, -5000.00), (6,   250.25),
 (8,   100.00);

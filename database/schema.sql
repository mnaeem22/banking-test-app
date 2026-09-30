-- ============================================
-- Banking Database  (MySQL)
-- ============================================

CREATE DATABASE IF NOT EXISTS DemoBankingDB;
USE DemoBankingDB;

-- 1. CUSTOMERS
CREATE TABLE IF NOT EXISTS Customers (
    CustomerID INT NOT NULL AUTO_INCREMENT,
    NAME       VARCHAR(100) NOT NULL,
    Email      VARCHAR(150) NOT NULL,
    City       VARCHAR(50)  NOT NULL,

    CONSTRAINT PK_Customers PRIMARY KEY (CustomerID)
);

-- 2. ACCOUNTS
CREATE TABLE IF NOT EXISTS Accounts (
    AccountID  INT NOT NULL AUTO_INCREMENT,
    CustomerID INT NOT NULL,
    Balance    DECIMAL(15,2) NOT NULL DEFAULT 0.00,

    CONSTRAINT PK_Accounts PRIMARY KEY (AccountID),
    CONSTRAINT FK_Accounts_Customers
        FOREIGN KEY (CustomerID) REFERENCES Customers(CustomerID)
);

-- 3. TRANSACTIONS
-- Amount is SIGNED: deposits are positive, withdrawals are negative.
CREATE TABLE IF NOT EXISTS Transactions (
    TransactionID BIGINT NOT NULL AUTO_INCREMENT,
    AccountID     INT NOT NULL,
    Amount        DECIMAL(15,2) NOT NULL,

    CONSTRAINT PK_Transactions PRIMARY KEY (TransactionID),
    CONSTRAINT FK_Transactions_Accounts
        FOREIGN KEY (AccountID) REFERENCES Accounts(AccountID)
);

-- Verify
SHOW TABLES;
DESCRIBE Customers;
DESCRIBE Accounts;
DESCRIBE Transactions;

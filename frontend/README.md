# 🏦 Confidential Bank & Credit Scoring

> **Zama Protocol Hackathon Submission**
>
> A privacy-preserving on-chain banking system powered by Fully Homomorphic Encryption (FHE).
> Customer balances, transfer amounts, and credit scores are **never exposed as plaintext on-chain** — yet the system operates correctly and verifiably.

---

## 🎯 Problem

Traditional on-chain banking is fully transparent by design:

- Anyone can see your balance and target you accordingly
- Applying for a loan requires disclosing your financial data to a third party
- Competing institutions can observe each other's positions and strategies

This level of transparency has prevented real-world financial institutions from adopting on-chain finance.

## 💡 Solution

With Zama's fhEVM, computation runs directly on encrypted data. This project implements a complete banking system where:

- **Balances** are stored as `euint64` ciphertexts — never visible to anyone except the account holder
- **Transfer amounts** are encrypted end-to-end — observers only see that a transfer occurred
- **Credit scoring** runs entirely under FHE — the lender receives only an encrypted boolean (`ebool`) indicating eligibility, never the underlying financial data
- **Loan amounts** are encrypted — the bank's portfolio is an aggregate of ciphertexts
- **Scoring parameters** are adjustable by the contract owner — the bank can tighten or loosen credit policy based on economic conditions, without exposing any customer data

---

## 🏗️ Architecture

```
Customer
   │
   ├─ deposit(encryptedAmount)  ──────────────┐
   ├─ withdraw(encryptedAmount)               │
   ├─ transfer(to, encryptedAmount)           ▼
   │                                  ConfidentialBank.sol
   │                                         │
   └─ computeScore()  ───────────────────►  ConfidentialCreditScorer.sol
                                             │  (scoring runs entirely under FHE)
                                             │  returns ebool only
                                             ▼
                                      ConfidentialLending.sol
                                             │
                                    applyForLoan(encryptedAmount)
                                    FHE.select(eligible, amount, 0)

Bank Admin (Owner)
   │
   └─ setScoringParameters()  ──────────────► ConfidentialCreditScorer.sol
                                             (adjusts thresholds & eligibility cutoff)
```

### Privacy Guarantees

| Data | Bank Owner | Customer | Scorer | Lender | Public |
|------|-----------|----------|--------|--------|--------|
| Balance amount | ❌ | ✅ | ❌ | ❌ | ❌ |
| Transfer amount | ❌ | ✅ | ❌ | ❌ | ❌ |
| Credit score | ❌ | ✅ | ✅ | ❌ | ❌ |
| Loan eligibility | ❌ | ✅ | ✅ | ✅ (ebool) | ❌ |
| Loan amount | ❌ | ✅ | ❌ | ✅ | ❌ |

---

## 📄 Contracts

### `ConfidentialBank.sol`

Core banking contract. All sensitive values stored as `euint64` ciphertexts.

| Function | Description |
|----------|-------------|
| `openAccount()` | Opens an account with an encrypted zero balance |
| `deposit(encryptedAmount, proof)` | Adds to balance; updates cumulative deposit tracker |
| `withdraw(encryptedAmount, proof)` | Uses `FHE.select` to avoid balance-revealing reverts |
| `transfer(to, encryptedAmount, proof)` | Peer-to-peer encrypted transfer |
| `getFinancialData(customer)` | Returns encrypted data — CreditScorer access only |
| `incrementMonthsActive(customer)` | Monthly tick; automatable via Chainlink Automation |

### `ConfidentialCreditScorer.sol`

Scores customers using three independent FHE sub-computations (100 points total):

| Criterion | Max Points | Default Thresholds |
|-----------|-----------|------------|
| Current balance | 40 pts | High: $10k / Med: $5k |
| Account tenure | 30 pts | High: 24mo / Med: 12mo |
| Total deposit volume | 30 pts | High: $50k / Med: $20k |

Score ≥ 50 → `isEligible = true` (encrypted `ebool`).
The `LendingContract` only ever receives this `ebool` — never the score integer or any balance figure.

**Dynamic Scoring Policy:** The contract owner can call `setScoringParameters()` to adjust all thresholds and the eligibility cutoff at any time. This mirrors real-world monetary policy — when credit conditions tighten, the bank raises the eligibility threshold; when they loosen, it lowers it. No customer data is ever exposed in this process.

### `ConfidentialLending.sol`

Handles loan issuance and repayment with fully encrypted amounts.

| Function | Description |
|----------|-------------|
| `applyForLoan(encryptedAmount, proof)` | Oblivious approval via `FHE.select(eligible, amount, 0)` |
| `repay(encryptedAmount, proof)` | Accumulates encrypted repayment |
| `markAsRepaid(borrower)` | Owner closes the loan |
| `getTotalLoanVolume()` | Owner reads encrypted portfolio aggregate |

---

## 🖥️ Frontend

A React + Vite frontend connects to the deployed Sepolia contracts and encrypts all inputs client-side using `@zama-fhe/relayer-sdk` before sending transactions.

### Pages

| Page | Description |
|------|-------------|
| Open Account | Create a new confidential bank account |
| Deposit / Withdraw | Encrypt and submit amounts via FHE relayer |
| Transfer | Send funds privately to another address |
| Credit Score | View your encrypted score with a visual progress bar |
| Apply for Loan | Submit an encrypted loan application |
| Scoring Policy | Admin panel to adjust scoring parameters (owner only) |

### Run Locally

```bash
cd confidential-bank-frontend
npm install
npm run dev
```

Open `http://localhost:5173` and connect your wallet (Rabby or MetaMask) on Sepolia.

---

## 🔧 Setup & Installation

### Prerequisites

- Node.js v18+
- Git

### 1. Clone the Repository

```bash
git clone https://github.com/umitaygul/zama_hackatlon
cd zama_hackatlon
```

### 2. Install Dependencies

```bash
npm install
npm install @openzeppelin/contracts --legacy-peer-deps
npm install @openzeppelin/confidential-contracts --legacy-peer-deps
```

### 3. Enable `viaIR` in `hardhat.config.ts`

```typescript
solidity: {
  version: "0.8.27",
  settings: {
    optimizer: { enabled: true, runs: 800 },
    evmVersion: "cancun",
    viaIR: true,
  },
},
```

### 4. Compile & Test

```bash
npx hardhat compile
npx hardhat test
```

Expected: **35 passing**

### 5. Deploy to Sepolia

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set ALCHEMY_API_KEY
npx hardhat run scripts/deploy.ts --network sepolia
```

---

## 🌐 Deployed Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| ConfidentialBank | `0x3C4382e87E92dC3814D662B1A938958288Fe85C1` |
| ConfidentialCreditScorer | `0xb51C5da0Fc124D32dF8b17068AC4b544A7Ea403c` |
| ConfidentialLending | `0x8b1dD90432B891c9bfF7207d8c1AEc3DE493BAE1` |

---

## 🔬 Technical Deep-Dive

### The Oblivious Conditional Pattern

Standard Solidity `if/else` cannot be used with encrypted values because evaluating the condition requires decryption. fhEVM solves this with `FHE.select(cond, a, b)`:

```solidity
// ❌ Cannot do this — requires decrypting balance
require(balance >= amount, "insufficient funds");

// ✅ Oblivious conditional — balance stays encrypted
ebool   hasFunds   = FHE.ge(balance, amount);
euint64 safeAmount = FHE.select(hasFunds, amount, FHE.asEuint64(0));
balance = FHE.sub(balance, safeAmount);
```

### Dynamic Scoring Policy

`setScoringParameters()` allows the contract owner to adjust all scoring thresholds and the eligibility cutoff on-chain — analogous to a central bank adjusting interest rates. Customer financial data remains fully encrypted throughout.

### Access Control via `FHE.allow`

- `CreditScorer` can **compute** on Bank ciphertext handles but cannot **decrypt** them
- `LendingContract` receives only the `ebool` eligibility flag — never the score
- Each customer can decrypt only their own data

---

## 🗺️ Roadmap

- [x] Core FHE banking contracts (deposit, withdraw, transfer)
- [x] Confidential credit scoring with three FHE sub-computations
- [x] Oblivious loan approval via `FHE.select`
- [x] Dynamic scoring policy via `setScoringParameters`
- [x] 35 passing tests covering all contracts
- [x] Sepolia testnet deployment
- [x] React frontend with wallet integration
- [ ] Chainlink Automation for monthly `incrementMonthsActive`
- [ ] Gateway async-decrypt callback for trustless repayment settlement
- [ ] Encrypted fixed-point interest rate calculation
- [ ] Multi-collateral loan support

---

## 📁 Project Structure

```
├── contracts/
│   ├── ConfidentialBank.sol
│   ├── ConfidentialCreditScorer.sol
│   ├── ConfidentialLending.sol
│   └── interfaces/
├── scripts/
│   └── deploy.ts
├── test/
│   └── ConfidentialBankSystem.test.ts
├── deployed-addresses.json
├── confidential-bank-frontend/
│   ├── src/
│   │   ├── pages/
│   │   ├── config/
│   │   └── components/
│   └── package.json
└── README.md
```

---

## 📜 License

BSD-3-Clause-Clear — see [Zama's licensing terms](https://github.com/zama-ai/fhevm).

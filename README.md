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

| Criterion | Max Points | Thresholds |
|-----------|-----------|------------|
| Current balance | 40 pts | High: $10k / Med: $5k |
| Account tenure | 30 pts | High: 24mo / Med: 12mo |
| Total deposit volume | 30 pts | High: $50k / Med: $20k |

Score ≥ 50 → `isEligible = true` (encrypted `ebool`).
The `LendingContract` only ever receives this `ebool` — never the score integer or any balance figure.

### `ConfidentialLending.sol`

Handles loan issuance and repayment with fully encrypted amounts.

| Function | Description |
|----------|-------------|
| `applyForLoan(encryptedAmount, proof)` | Oblivious approval via `FHE.select(eligible, amount, 0)` |
| `repay(encryptedAmount, proof)` | Accumulates encrypted repayment |
| `markAsRepaid(borrower)` | Owner closes the loan |
| `getTotalLoanVolume()` | Owner reads encrypted portfolio aggregate |

---

## 🔧 Setup & Installation

### Prerequisites

- Node.js v18+
- Git

### 1. Clone Zama's Hardhat Template

```bash
git clone https://github.com/zama-ai/fhevm-hardhat-template
cd fhevm-hardhat-template
```

### 2. Install Dependencies

```bash
npm install
npm install @openzeppelin/contracts --legacy-peer-deps
npm install @openzeppelin/confidential-contracts --legacy-peer-deps
```

### 3. Enable `viaIR` in `hardhat.config.ts`

Inside the `solidity.settings` block, add:

```typescript
solidity: {
  version: "0.8.27",
  settings: {
    optimizer: { enabled: true, runs: 800 },
    evmVersion: "cancun",
    viaIR: true,   // ← add this
  },
},
```

### 4. Copy Project Files

```
contracts/
├── ConfidentialBank.sol
├── ConfidentialCreditScorer.sol
├── ConfidentialLending.sol
└── interfaces/
    ├── IConfidentialBank.sol
    └── IConfidentialCreditScorer.sol

scripts/
└── deploy.ts

test/
└── ConfidentialBankSystem.test.ts
```

### 5. Compile

```bash
npx hardhat compile
```

### 6. Run Tests

```bash
# Start local fhEVM node (Terminal 1)
npx hardhat node

# Run tests (Terminal 2)
npx hardhat test test/ConfidentialBankSystem.test.ts
```

Expected output:
```
  Confidential Bank & Credit Scoring
    ConfidentialBank
      ✔ should open an account
      ✔ should revert on duplicate account
      ✔ should initialise balance to zero
      ✔ should increase balance after deposit
      ✔ should accumulate multiple deposits
      ✔ should revert if caller has no account
      ✔ should decrease balance
      ✔ should withdraw 0 when amount exceeds balance (oblivious conditional)
      ✔ should move funds between accounts
      ✔ should not change balances when amount exceeds balance
      ✔ should revert on self-transfer
      ✔ should revert if recipient has no account
    ConfidentialCreditScorer
      ✔ should return 0 timestamp before score is computed
      ✔ should record timestamp after computeScore
      ✔ should give minimum score with no deposits or tenure
      ✔ should give maximum score with strong financials
      ✔ should reject unauthorized queries
    ConfidentialLending
      ✔ should create active loan for eligible customer
      ✔ should approve 0 for ineligible customer
      ✔ should revert if customer has no bank account
      ✔ should revert if no score computed
      ✔ should revert on duplicate active loan
      ✔ should accumulate repayments
      ✔ should allow owner to mark loan as repaid
      ✔ should reject unauthorized loan queries
      ✔ should only allow owner to read total loan volume

  26 passing
```

### 7. Deploy

```bash
npx hardhat run scripts/deploy.ts --network localhost
```

---

## 🔬 Technical Deep-Dive

### Why TFHE?

TFHE (Fast Fully Homomorphic Encryption) evaluates boolean gates in ~10ms. Arithmetic on `euint64` operands (`add`, `ge`, `select`) runs in ~100–300ms per operation — practical latency for on-chain finance. The underlying scheme is also quantum-resistant.

### The Oblivious Conditional Pattern

Standard Solidity `if/else` cannot be used with encrypted values because evaluating the condition requires decryption. fhEVM solves this with `FHE.select(cond, a, b)`, which computes both branches homomorphically and returns the correct result without revealing which branch was taken.

**Withdraw example:**
```solidity
// ❌ Cannot do this — requires decrypting balance to evaluate
require(balance >= amount, "insufficient funds");

// ✅ Oblivious conditional — balance stays encrypted throughout
ebool   hasFunds   = FHE.ge(balance, amount);
euint64 safeAmount = FHE.select(hasFunds, amount, FHE.asEuint64(0));
balance = FHE.sub(balance, safeAmount);
```

If the balance is insufficient, `safeAmount` is encrypted zero. The transaction succeeds silently — no revert, no information leak.

### Access Control via `FHE.allow`

`FHE.allow(handle, address)` records on-chain which addresses are permitted to operate on or decrypt a given ciphertext handle. This creates a fine-grained permission layer:

- `CreditScorer` can **compute** on Bank ciphertext handles but cannot **decrypt** them
- `LendingContract` can receive only the `ebool` eligibility flag — never the score
- Each customer can decrypt only their own data

### Compliance Alignment

Personal financial data is never written to the chain in plaintext, satisfying the GDPR *data minimization* principle. Regulatory auditors can be granted selective decrypt access via `FHE.allow` without exposing data to the general public — a model compatible with emerging confidential finance regulations.

---

## 🗺️ Roadmap

- [ ] Chainlink Automation for monthly `incrementMonthsActive`
- [ ] Gateway async-decrypt callback for trustless repayment settlement
- [ ] React frontend with fhEVM SDK for client-side encrypt/decrypt
- [ ] Encrypted fixed-point interest rate calculation
- [ ] Multi-collateral loan support
- [ ] Sepolia testnet deployment

---

## 📁 Project Structure

```
├── contracts/
│   ├── ConfidentialBank.sol
│   ├── ConfidentialCreditScorer.sol
│   ├── ConfidentialLending.sol
│   └── interfaces/
│       ├── IConfidentialBank.sol
│       └── IConfidentialCreditScorer.sol
├── scripts/
│   └── deploy.ts
├── test/
│   └── ConfidentialBankSystem.test.ts
├── deployed-addresses.json      ← generated after deploy
└── README.md
```

---

## 📜 License

BSD-3-Clause-Clear — see [Zama's licensing terms](https://github.com/zama-ai/fhevm).

# Confidential Bank & Credit Scoring
**Zama Protocol Hackathon Submission**

A privacy-preserving on-chain banking system powered by Fully Homomorphic Encryption (FHE). Customer balances, transfer amounts, and credit scores are never exposed as plaintext on-chain — yet the system operates correctly and verifiably.

---

## 🎯 Problem

Traditional on-chain banking is fully transparent by design:

- Anyone can see your balance and target you accordingly
- Applying for a loan requires disclosing your financial data to a third party
- Competing institutions can observe each other's positions and strategies

This level of transparency has prevented real-world financial institutions from adopting on-chain finance.

---

## 💡 Solution

With Zama's fhEVM, computation runs directly on encrypted data. This project implements a complete banking system where:

- **Balances** are stored as `euint64` ciphertexts — never visible to anyone except the account holder
- **Transfer amounts** are encrypted end-to-end — observers only see that a transfer occurred
- **Credit scoring** runs entirely under FHE — the lender receives only an encrypted boolean (`ebool`) indicating eligibility, never the underlying financial data
- **Loan amounts** are encrypted — the bank's portfolio is an aggregate of ciphertexts
- **Scoring parameters** are adjustable by the contract owner — the bank can tighten or loosen credit policy based on economic conditions, without exposing any customer data
- **Fresh score on every loan application** — `applyForLoan` internally calls `computeScore` to ensure the latest balance is always reflected; a user cannot game the system by withdrawing funds after scoring
- **Balance read directly from bank** — balance is never routed through the scorer's snapshot, ensuring it always reflects the latest on-chain state

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
   └─ applyForLoan(encryptedAmount) ─────────► ConfidentialLending.sol
                                             │  (internally calls computeScore first)
                                             │
                                             ▼
                                  ConfidentialCreditScorer.sol
                                             │  (scoring runs entirely under FHE)
                                             │  getEligibility() uses LIVE threshold
                                             │  returns fresh ebool only
                                             │
                                    FHE.select(eligible, amount, 0)

Bank Admin (Owner)
   │
   └─ setScoringParameters()  ──────────────► ConfidentialCreditScorer.sol
                                             (adjusts thresholds & eligibility cutoff)
                                             (takes effect on next loan application immediately)
```

---

## 🔒 Privacy Guarantees

| Data | Bank Owner | Customer | Scorer | Lender | Public |
|------|-----------|----------|--------|--------|--------|
| Balance amount | ❌ | ✅ | ❌ | ❌ | ❌ |
| Transfer amount | ❌ | ✅ | ❌ | ❌ | ❌ |
| Credit score | ❌ | ✅ | ✅ | ❌ | ❌ |
| Loan eligibility | ❌ | ✅ | ✅ | ✅ (ebool) | ❌ |
| Loan amount | ❌ | ✅ | ❌ | ✅ | ❌ |

---

## 📄 Contracts

### ConfidentialBank.sol

Core banking contract. All sensitive values stored as `euint64` ciphertexts.

| Function | Description |
|----------|-------------|
| `openAccount()` | Opens an account with an encrypted zero balance |
| `deposit(encryptedAmount, proof)` | Adds to balance; updates cumulative deposit tracker. Sets ACL for scorer immediately |
| `withdraw(encryptedAmount, proof)` | Uses `FHE.select` to avoid balance-revealing reverts. Sets ACL for scorer immediately |
| `transfer(to, encryptedAmount, proof)` | Peer-to-peer encrypted transfer. Sets ACL for both sender and recipient |
| `getFinancialData(customer)` | Returns encrypted data — CreditScorer access only |
| `getMyBalance()` | Returns encrypted balance handle — view function, no tx needed |
| `incrementMonthsActive(customer)` | Monthly tick; automatable via Chainlink Automation |
| `creditDeposit(customer, amount)` | Lending contract calls this to add approved loan to balance |
| `debitBalance(customer, amount)` | Lending contract calls this on repayment |

### ConfidentialCreditScorer.sol

Scores customers using three independent FHE sub-computations (100 points total):

| Criterion | Max Points | Default Thresholds |
|-----------|-----------|-------------------|
| Current balance | 40 pts | High: $10k / Med: $5k |
| Account tenure | 30 pts | High: 24mo / Med: 12mo |
| Total deposit volume | 30 pts | High: $50k / Med: $20k |

**Key design decisions:**

- `getEligibility()` does **not** return the cached `isEligible` stored at compute time. Instead, it re-evaluates `score >= eligibilityThreshold` using the **current live threshold**. This means if an admin raises the threshold, existing scores immediately reflect the new policy — no re-computation needed.
- `computeScore()` is called internally by `applyForLoan` — the score is always fresh at loan application time.
- `getMyScore()` is a **view function** — no wallet transaction needed, no gas cost. ACL permissions are set during `computeScore`.
- Balance is **not stored** in the scorer — it is read directly from the bank contract on the frontend, bypassing any stale snapshot issues caused by Zama's asynchronous coprocessor model.

### ConfidentialLending.sol

Handles loan issuance and repayment with fully encrypted amounts.

| Function | Description |
|----------|-------------|
| `applyForLoan(encryptedAmount, proof)` | Calls `computeScore` first, then oblivious approval via `FHE.select(eligible && withinLimit, amount, 0)` |
| `repay()` | Deducts the full encrypted loan amount from bank balance |
| `markAsDefaulted(borrower)` | Owner marks overdue loans as defaulted |
| `getTotalLoanVolume()` | Owner reads encrypted portfolio aggregate |

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

### Live Threshold Eligibility

`getEligibility()` always re-computes eligibility against the current threshold rather than returning a cached result:

```solidity
// ❌ Old approach — cached at compute time, stale after policy change
return _scores[customer].isEligible;

// ✅ New approach — live threshold, always accurate
ebool freshEligible = FHE.ge(
    _scores[customer].score,
    FHE.asEuint64(eligibilityThreshold)
);
FHE.allow(freshEligible, lendingContract);
return freshEligible;
```

### Fresh Score on Loan Application

`applyForLoan` calls `computeScore` internally before checking eligibility. This prevents a user from inflating their score with a large deposit, then withdrawing before the loan is processed:

```solidity
function applyForLoan(bytes32 encryptedAmount, bytes calldata inputProof) external {
    // Fresh score — reflects current balance at application time
    scorer.computeScore(msg.sender);

    // Live threshold comparison
    ebool eligible = scorer.getEligibility(msg.sender);
    ...
}
```

### Balance Read Directly from Bank

Zama's fhEVM uses a coprocessor model — FHE operations are executed symbolically on-chain and processed asynchronously by a coprocessor network. This means a ciphertext handle produced in one transaction may not be immediately available for decryption in the next.

To avoid stale balance reads, the frontend reads the balance handle directly from `bank.getMyBalance()` rather than from the scorer's stored snapshot. This ensures the decrypted balance always reflects the latest on-chain state:

```
❌ Old: balance → computeScore → scorer snapshot → decrypt (stale)
✅ New: balance → bank.getMyBalance() → decrypt (always fresh)
```

### Minimal Wallet Signatures

The frontend is designed to minimize wallet interactions:

| Action | Signatures Required |
|--------|-------------------|
| Refresh Account Data | 1 tx (computeScore) + 1 decrypt (score + balance, two contracts, single EIP-712 signature) |
| Deposit / Withdraw | 1 tx |
| Transfer | 1 tx |
| Apply for Loan | 1 tx (includes computeScore internally) |
| Repay Loan | 1 tx |

### Access Control via FHE.allow

- `CreditScorer` can compute on Bank ciphertext handles but cannot decrypt them
- `LendingContract` receives only the `ebool` eligibility flag — never the score
- Each customer can decrypt only their own data
- ACL permissions for deposit/withdraw/transfer are set in the same transaction as the balance change — no separate ACL transaction needed

---

## 🖥️ Frontend

A React + Vite frontend connects to the deployed Sepolia contracts and encrypts all inputs client-side using `@zama-fhe/relayer-sdk` before sending transactions.

### Pages

| Page | Description |
|------|-------------|
| Open Account | Create a new confidential bank account |
| Deposit / Withdraw | Encrypt and submit amounts via FHE relayer |
| Transfer | Send funds privately. Proper error handling for invalid recipients |
| My Account | View your encrypted score and balance with only 2 wallet interactions. Loan Eligibility updates instantly when admin changes the threshold |
| Apply for Loan | Submit an encrypted loan application — amount never visible on-chain |
| Repay Loan | Repay active loan — reveal encrypted amount before repaying |
| Scoring Policy | Admin panel — waits for full on-chain confirmation before showing success |

### Run Locally

```bash
cd frontend
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
npm install --legacy-peer-deps
```

### 3. Compile & Test

```bash
npx hardhat compile
npx hardhat test
```

Expected: **36 passing**

### 4. Deploy to Sepolia

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set ALCHEMY_API_KEY
npx hardhat run scripts/deploy.ts --network sepolia
```

### 5. Update Frontend ABIs & Addresses

After deploy, update ABIs automatically:

```bash
node -e "
const fs = require('fs');
const bank = require('./artifacts/contracts/ConfidentialBank.sol/ConfidentialBank.json');
const scorer = require('./artifacts/contracts/ConfidentialCreditScorer.sol/ConfidentialCreditScorer.json');
const lending = require('./artifacts/contracts/ConfidentialLending.sol/ConfidentialLending.json');
const abis = { ConfidentialBank: bank.abi, ConfidentialCreditScorer: scorer.abi, ConfidentialLending: lending.abi };
fs.writeFileSync('./frontend/src/config/abis.json', JSON.stringify(abis, null, 2));
console.log('abis.json updated!');
"
```

Then update `frontend/src/config/contracts.ts` with the new deployed addresses.

---

## 🌐 Deployed Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| ConfidentialBank | `0x977cb08Ec75B9bC55541bCC1c539C57BC9C2Db9a` |
| ConfidentialCreditScorer | `0x347a466DE9D85176B12b5B307968A5ED5255EBA2` |
| ConfidentialLending | `0x5ea871F969adB28856d9a093FD1949F0C4930f27` |

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
│   └── ConfidentialBankSystem_v3.test.ts
├── deployed-addresses.json
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── OpenAccount.tsx
│   │   │   ├── Deposit.tsx
│   │   │   ├── Transfer.tsx
│   │   │   ├── CreditScore.tsx
│   │   │   ├── ApplyLoan.tsx
│   │   │   ├── Repay.tsx
│   │   │   └── AdminPanel.tsx
│   │   ├── config/
│   │   │   ├── contracts.ts
│   │   │   ├── abis.json
│   │   │   └── fhevm.ts
│   │   └── components/
│   │       └── Navbar.tsx
│   └── package.json
└── README.md
```

---

## 🗺️ Roadmap

- [x] Core FHE banking contracts (deposit, withdraw, transfer)
- [x] Confidential credit scoring with three FHE sub-computations
- [x] Oblivious loan approval via `FHE.select`
- [x] Dynamic scoring policy via `setScoringParameters`
- [x] Live threshold eligibility — policy changes take effect immediately
- [x] Fresh score on every loan application — prevents balance manipulation
- [x] Balance read directly from bank — bypasses coprocessor async delay
- [x] Minimal wallet signatures — 2 interactions for full account refresh
- [x] 36 passing tests covering all contracts
- [x] Sepolia testnet deployment
- [x] React frontend with wallet integration
- [ ] Chainlink Automation for monthly `incrementMonthsActive`
- [ ] Gateway async-decrypt callback for trustless repayment settlement
- [ ] Encrypted fixed-point interest rate calculation
- [ ] Multi-collateral loan support

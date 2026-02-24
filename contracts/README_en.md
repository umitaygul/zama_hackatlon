# Confidential Bank & Credit Scoring — fhEVM

> **Zama Protocol Hackathon Submission**  
> A privacy-preserving banking system where customer balances, transfer amounts, and credit scores are **never exposed as plaintext on-chain**.

---

## Problem

Traditional on-chain banking is fully transparent:
- Anyone can see your balance and target you accordingly
- Applying for a loan requires disclosing your income to a third party
- Competing institutions can observe each other's positions

## Solution

With Zama's fhEVM, computations run directly on encrypted data. Balances are encrypted, transfer amounts are encrypted, credit scores are computed under FHE — yet the system operates correctly without ever revealing the underlying values.

---

## Architecture

```
Customer
   │
   ├─ deposit(encryptedAmount)  ──────────────┐
   ├─ withdraw(encryptedAmount)               │
   ├─ transfer(to, encryptedAmount)           ▼
   │                                  ConfidentialBank
   │                                         │
   └─ computeScore()  ───────────────────►  CreditScorer
                                             │  (scoring runs under FHE)
                                             │  returns ebool only
                                             ▼
                                      ConfidentialLending
                                             │
                                    applyForLoan(encryptedAmount)
                                    FHE.select(eligible, amount, 0)
```

### Privacy Guarantees

| Data | Bank | Customer | Scorer | Lender | Public |
|------|------|----------|--------|--------|--------|
| Balance amount | ✅ | ✅ | ❌ (FHE only) | ❌ | ❌ |
| Transfer amount | ❌ | ✅ | ❌ | ❌ | ❌ |
| Credit score | ❌ | ✅ | ✅ | ❌ | ❌ |
| Loan eligibility | ❌ | ✅ | ✅ | ✅ (ebool only) | ❌ |
| Loan amount | ❌ | ✅ | ❌ | ✅ | ❌ |

---

## Contracts

### `ConfidentialBank.sol`

The core banking contract. All sensitive values are stored as `euint64` ciphertexts.

| Function | Description |
|----------|-------------|
| `openAccount()` | Opens an account with an encrypted zero balance |
| `deposit(encryptedAmount, proof)` | Adds to balance; updates cumulative deposit tracker |
| `withdraw(encryptedAmount, proof)` | Uses `FHE.select` to avoid balance-revealing reverts |
| `transfer(to, encryptedAmount, proof)` | Peer-to-peer encrypted transfer |
| `getFinancialData(customer)` | Returns encrypted data — CreditScorer access only |
| `incrementMonthsActive(customer)` | Monthly tick; automatable via Chainlink Automation |

### `ConfidentialCreditScorer.sol`

Scores customers using three FHE sub-computations, totalling 100 points:

| Criterion | Max Points | Logic |
|-----------|-----------|-------|
| Current balance | 40 | `FHE.select` on two thresholds |
| Account tenure (months) | 30 | `FHE.select` on two thresholds |
| Total deposit volume | 30 | `FHE.select` on two thresholds |

Score ≥ 50 → `isEligible = true` (encrypted). The `LendingContract` only receives this `ebool` — never the score integer or any balance figure.

### `ConfidentialLending.sol`

Handles loan issuance and repayment with fully encrypted amounts.

| Function | Description |
|----------|-------------|
| `applyForLoan(encryptedAmount, proof)` | Oblivious approval: `FHE.select(eligible, amount, 0)` |
| `repay(encryptedAmount, proof)` | Accumulates encrypted repayment |
| `markAsRepaid(borrower)` | Owner closes the loan (Gateway callback in production) |
| `getTotalLoanVolume()` | Owner reads encrypted portfolio aggregate |

---

## Setup

```bash
# 1. Clone Zama's Hardhat template
git clone https://github.com/zama-ai/fhevm-hardhat-template
cd fhevm-hardhat-template

# 2. Install dependencies
npm install
npm install @openzeppelin/confidential-contracts

# 3. Copy contracts into the project
cp -r /path/to/this/repo/contracts ./contracts/

# 4. Compile
npx hardhat compile

# 5. Start local fhEVM node
npx hardhat node

# 6. Deploy
npx hardhat run scripts/deploy.ts --network localhost
```

---

## Technical Deep-Dive

### Why TFHE?

TFHE (Fast Fully Homomorphic Encryption) evaluates boolean gates in ~10 ms. Arithmetic on `euint64` operands (`add`, `gte`, `select`) runs in ~100–300 ms per operation — practical latency for on-chain finance.

### The Oblivious Conditional Pattern

Standard Solidity `if/else` cannot be used with encrypted values because evaluating the condition requires decryption. fhEVM solves this with `FHE.select(cond, a, b)`, which computes *both* branches and returns the correct result without revealing which branch was taken.

**Withdraw example:**
```solidity
// ❌ Cannot do this — requires decrypting balance
require(balance >= amount, "insufficient funds");

// ✅ Oblivious conditional — no information leaked
ebool   hasFunds   = FHE.gte(balance, amount);
euint64 safeAmount = FHE.select(hasFunds, amount, FHE.asEuint64(0));
```

### Access Control

`FHE.allow(handle, address)` records on-chain which addresses are permitted to operate on or decrypt a given ciphertext handle. The CreditScorer processes Bank ciphertext handles under FHE but cannot decrypt them — it only holds computation rights, not decryption rights.

### GDPR / Compliance Alignment

Personal financial data is never written to the chain in plaintext, satisfying the *data minimization* principle. Regulatory auditors can be granted selective decrypt access via `FHE.allow` without exposing data to the general public.

---

## Roadmap

- [ ] Chainlink Automation for monthly `incrementMonthsActive`
- [ ] Gateway async-decrypt callback for trustless repayment settlement
- [ ] fhEVM SDK frontend: client-side encrypt/decrypt flows
- [ ] Encrypted fixed-point interest rate calculation
- [ ] Multi-collateral loan support

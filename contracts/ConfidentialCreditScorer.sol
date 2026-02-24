// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IConfidentialBank} from "./interfaces/IConfidentialBank.sol";

/**
 * @title  ConfidentialCreditScorer
 * @notice Computes a confidential credit score from a customer's encrypted bank data.
 *         All scoring arithmetic runs entirely under FHE — no plaintext balance,
 *         deposit, or tenure value is ever revealed during computation.
 *
 *         Scoring breakdown (100 points total):
 *           • Current balance level   →  0 – 40 pts
 *           • Account tenure (months) →  0 – 30 pts
 *           • Total deposit volume    →  0 – 30 pts
 *
 *         The LendingContract only receives an encrypted boolean (ebool) indicating
 *         whether the customer clears the eligibility threshold — never the score itself.
 *
 * @dev    Threshold constants are in 6-decimal USDC units (e.g., 10_000e6 = $10,000).
 */
contract ConfidentialCreditScorer is ZamaEthereumConfig, Ownable2Step {

    // ─── Scoring Thresholds ───────────────────────────────────────────────────

    uint64 public constant BALANCE_THRESHOLD_HIGH  = 10_000e6; // $10,000 USDC
    uint64 public constant BALANCE_THRESHOLD_MED   =  5_000e6; // $5,000 USDC
    uint64 public constant DEPOSIT_THRESHOLD_HIGH  = 50_000e6; // $50,000 cumulative
    uint64 public constant DEPOSIT_THRESHOLD_MED   = 20_000e6; // $20,000 cumulative
    uint64 public constant MONTHS_THRESHOLD_HIGH   = 24;       // 2 years
    uint64 public constant MONTHS_THRESHOLD_MED    = 12;       // 1 year

    /// @notice Minimum score required to be eligible for a loan
    uint64 public constant ELIGIBILITY_THRESHOLD   = 50;

    // ─── State ────────────────────────────────────────────────────────────────

    IConfidentialBank public bank;
    address           public lendingContract;

    struct CreditScore {
        euint64 score;       // Encrypted score 0–100
        ebool   isEligible;  // Encrypted eligibility flag
        uint256 computedAt;  // Plaintext timestamp (only reveals *when*, not *what*)
    }

    mapping(address => CreditScore) private _scores;

    // ─── Events ───────────────────────────────────────────────────────────────

    event ScoreComputed(address indexed customer, uint256 timestamp);
    event LendingContractSet(address indexed lending);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyLending() {
        require(msg.sender == lendingContract, "Scorer: caller is not lending contract");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address owner_, address bank_) Ownable(owner_) {
        bank = IConfidentialBank(bank_);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setLendingContract(address lending_) external onlyOwner {
        lendingContract = lending_;
        emit LendingContractSet(lending_);
    }

    // ─── Score Computation ────────────────────────────────────────────────────

    /**
     * @notice Computes a fresh credit score for the given customer.
     *         Can be triggered by the customer or the bank.
     *
     * @dev    Workflow:
     *           1. Pull encrypted financial data from ConfidentialBank
     *           2. Perform three independent FHE scoring sub-computations
     *           3. Sum the sub-scores under FHE
     *           4. Derive an encrypted eligibility boolean via FHE.ge
     *           5. Grant access permissions to the customer and LendingContract
     *
     *         All intermediate values remain encrypted throughout.
     */
    function computeScore(address customer) external {
        // Step 1 — fetch encrypted inputs from the bank
        (
            euint64 balance,
            euint64 totalDeposited,
            euint64 monthsActive
        ) = bank.getFinancialData(customer);

        // ── Balance Score (0 – 40 pts) ────────────────────────────────────────
        // balance >= HIGH  → 40 pts
        // balance >= MED   → 20 pts
        // otherwise        →  5 pts
        ebool balHigh = FHE.ge(balance, FHE.asEuint64(BALANCE_THRESHOLD_HIGH));
        ebool balMed  = FHE.ge(balance, FHE.asEuint64(BALANCE_THRESHOLD_MED));

        euint64 balanceScore = FHE.select(
            balHigh,
            FHE.asEuint64(40),
            FHE.select(balMed, FHE.asEuint64(20), FHE.asEuint64(5))
        );

        // ── Tenure Score (0 – 30 pts) ─────────────────────────────────────────
        // months >= 24  → 30 pts
        // months >= 12  → 15 pts
        // otherwise     →  3 pts
        ebool monthsHigh = FHE.ge(monthsActive, FHE.asEuint64(MONTHS_THRESHOLD_HIGH));
        ebool monthsMed  = FHE.ge(monthsActive, FHE.asEuint64(MONTHS_THRESHOLD_MED));

        euint64 tenureScore = FHE.select(
            monthsHigh,
            FHE.asEuint64(30),
            FHE.select(monthsMed, FHE.asEuint64(15), FHE.asEuint64(3))
        );

        // ── Deposit Volume Score (0 – 30 pts) ─────────────────────────────────
        // totalDeposited >= HIGH  → 30 pts
        // totalDeposited >= MED   → 15 pts
        // otherwise               →  3 pts
        ebool depHigh = FHE.ge(totalDeposited, FHE.asEuint64(DEPOSIT_THRESHOLD_HIGH));
        ebool depMed  = FHE.ge(totalDeposited, FHE.asEuint64(DEPOSIT_THRESHOLD_MED));

        euint64 depositScore = FHE.select(
            depHigh,
            FHE.asEuint64(30),
            FHE.select(depMed, FHE.asEuint64(15), FHE.asEuint64(3))
        );

        // ── Total Score & Eligibility ─────────────────────────────────────────
        euint64 totalScore = FHE.add(FHE.add(balanceScore, tenureScore), depositScore);
        ebool   eligible   = FHE.ge(totalScore, FHE.asEuint64(ELIGIBILITY_THRESHOLD));

        // Persist the score
        _scores[customer] = CreditScore({
            score:      totalScore,
            isEligible: eligible,
            computedAt: block.timestamp
        });

        // ── Access Permissions ────────────────────────────────────────────────
        // This contract retains access to reuse handles
        FHE.allowThis(totalScore);
        FHE.allowThis(eligible);
        // Customer can decrypt their own score and eligibility
        FHE.allow(totalScore, customer);
        FHE.allow(eligible,   customer);
        // LendingContract receives only the eligibility flag — never the score
        if (lendingContract != address(0)) {
            FHE.allow(eligible, lendingContract);
        }

        emit ScoreComputed(customer, block.timestamp);
    }

    // ─── Lending Contract Access ──────────────────────────────────────────────

    /**
     * @notice Returns an encrypted eligibility boolean to the LendingContract.
     *         Only the lending contract may call this function.
     *
     * @dev    The lender learns *nothing* about the underlying score or balance —
     *         only an encrypted bit indicating whether the customer qualifies.
     *         The plaintext of this bit is revealed only when the lender decrypts
     *         it via the Gateway KMS after the loan decision is made.
     */
    function getEligibility(address customer)
        external
        onlyLending
        returns (ebool)
    {
        require(_scores[customer].computedAt > 0, "Scorer: no score computed yet");

        // Refresh lending contract's access on the eligibility handle
        FHE.allow(_scores[customer].isEligible, lendingContract);

        return _scores[customer].isEligible;
    }

    // ─── Customer Access ──────────────────────────────────────────────────────

    /**
     * @notice Returns the customer's encrypted score handles for client-side decryption.
     * @dev    Only the customer or the contract owner may query this.
     */
    function getMyScore(address customer)
        external
        view
        returns (euint64 score, ebool eligible, uint256 computedAt)
    {
        require(
            msg.sender == customer || msg.sender == owner(),
            "Scorer: unauthorized"
        );
        CreditScore storage cs = _scores[customer];
        return (cs.score, cs.isEligible, cs.computedAt);
    }

    /// @notice Returns the timestamp of the most recent score computation (plaintext).
    function getScoreTimestamp(address customer) external view returns (uint256) {
        return _scores[customer].computedAt;
    }
}

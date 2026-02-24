// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {FHE, externalEuint64, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IConfidentialCreditScorer} from "./interfaces/IConfidentialCreditScorer.sol";
import {IConfidentialBank} from "./interfaces/IConfidentialBank.sol";

/**
 * @title  ConfidentialLending
 * @notice Issues and tracks confidential loans based on an encrypted credit eligibility flag.
 *
 *         Privacy model:
 *           • The lender never sees the borrower's balance, score, or requested amount.
 *           • Loan approval is determined via FHE.select(eligible, amount, 0):
 *             if eligible  → approved amount = requested amount (encrypted)
 *             if not       → approved amount = 0               (encrypted)
 *           • Loan amounts and repayment progress remain encrypted at all times.
 *           • Only the borrower can decrypt their own loan figures.
 *
 * @dev    Loan status transitions:
 *           None → Active (on applyForLoan)
 *           Active → Repaid (markAsRepaid — owner, or future Gateway callback)
 *           Active → Defaulted (markAsDefaulted — owner, after due date)
 */
contract ConfidentialLending is ZamaEthereumConfig, Ownable2Step {

    // ─── Constants ────────────────────────────────────────────────────────────

    uint64  public constant MAX_LOAN_AMOUNT = 100_000e6; // $100,000 USDC
    uint64  public constant MIN_LOAN_AMOUNT =     500e6; // $500 USDC
    uint256 public constant LOAN_DURATION   = 30 days;

    // ─── State ────────────────────────────────────────────────────────────────

    IConfidentialCreditScorer public scorer;
    IConfidentialBank          public bank;

    enum LoanStatus { None, Active, Repaid, Defaulted }

    struct Loan {
        euint64    amount;        // Encrypted approved loan amount
        euint64    repaidAmount;  // Encrypted cumulative repayment
        LoanStatus status;        // Plaintext status (not sensitive)
        uint256    approvedAt;    // Plaintext approval timestamp
        uint256    dueDate;       // Plaintext due date
    }

    mapping(address => Loan) private _loans;

    /// @notice Encrypted aggregate of all outstanding loan amounts (portfolio view)
    euint64 private _totalLoanVolume;

    // ─── Events ───────────────────────────────────────────────────────────────

    /// @dev  Amounts are intentionally excluded from events to prevent information leakage.
    event LoanApplied(address indexed borrower);
    event LoanRepaid(address indexed borrower);
    event LoanDefaulted(address indexed borrower);

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address owner_,
        address scorer_,
        address bank_
    ) Ownable(owner_) {
        scorer           = IConfidentialCreditScorer(scorer_);
        bank             = IConfidentialBank(bank_);
        _totalLoanVolume = FHE.asEuint64(0);
        FHE.allowThis(_totalLoanVolume);
    }

    // ─── Loan Application ─────────────────────────────────────────────────────

    /**
     * @notice Apply for a loan.
     *
     * @dev    Processing steps:
     *           1. Fetch encrypted eligibility boolean from CreditScorer
     *           2. Decrypt the requested amount from the encrypted input
     *           3. FHE.select(eligible, requestedAmount, 0) — oblivious approval
     *           4. Persist the encrypted approved amount
     *           5. Grant borrower access to their loan handles
     *
     *         The lender (contract owner) never learns the requested amount or
     *         whether the customer was eligible — only that a loan event occurred.
     *
     * @param encryptedAmount  Requested loan amount, encrypted client-side
     * @param inputProof       ZKPoK for the encrypted input
     */
    function applyForLoan(
        bytes32 encryptedAmount,
        bytes calldata inputProof
    ) external {
        require(bank.hasAccount(msg.sender),   "Lending: no bank account");
        require(
            _loans[msg.sender].status == LoanStatus.None ||
            _loans[msg.sender].status == LoanStatus.Repaid,
            "Lending: existing active loan"
        );

        // Step 1 — get encrypted eligibility (no balance or score exposed)
        ebool eligible = scorer.getEligibility(msg.sender);

        // Step 2 — decode the encrypted requested amount
        euint64 requestedAmount = FHE.fromExternal(
            externalEuint64.wrap(encryptedAmount),
            inputProof
        );

        // Step 3 — oblivious approval:
        //   eligible  → approvedAmount = requestedAmount
        //   !eligible → approvedAmount = 0
        euint64 approvedAmount = FHE.select(eligible, requestedAmount, FHE.asEuint64(0));

        // Step 4 — update encrypted portfolio total
        _totalLoanVolume = FHE.add(_totalLoanVolume, approvedAmount);
        FHE.allowThis(_totalLoanVolume);

        // Step 5 — persist loan record
        euint64 initialRepaid = FHE.asEuint64(0);

        _loans[msg.sender] = Loan({
            amount:       approvedAmount,
            repaidAmount: initialRepaid,
            status:       LoanStatus.Active,
            approvedAt:   block.timestamp,
            dueDate:      block.timestamp + LOAN_DURATION
        });

        // Grant the borrower access to decrypt their own loan figures
        FHE.allowThis(approvedAmount);
        FHE.allow(approvedAmount, msg.sender);
        FHE.allowThis(initialRepaid);
        FHE.allow(initialRepaid, msg.sender);

        emit LoanApplied(msg.sender);
    }

    // ─── Repayment ────────────────────────────────────────────────────────────

    /**
     * @notice Submit an encrypted repayment against the caller's active loan.
     *         Partial payments are supported; the running total stays encrypted.
     *
     * @dev    Full repayment detection requires a Gateway async-decrypt callback
     *         (FHE.ge(repaid, amount) yields an ebool that cannot be evaluated
     *         synchronously). For this prototype the owner calls markAsRepaid()
     *         after verifying off-chain. A production version would use the
     *         Zama Gateway KMS for trustless on-chain settlement.
     */
    function repay(
        bytes32 encryptedAmount,
        bytes calldata inputProof
    ) external {
        require(
            _loans[msg.sender].status == LoanStatus.Active,
            "Lending: no active loan"
        );

        euint64 payment = FHE.fromExternal(
            externalEuint64.wrap(encryptedAmount),
            inputProof
        );

        Loan storage loan = _loans[msg.sender];
        loan.repaidAmount = FHE.add(loan.repaidAmount, payment);

        FHE.allowThis(loan.repaidAmount);
        FHE.allow(loan.repaidAmount, msg.sender);

        emit LoanRepaid(msg.sender);
    }

    // ─── Owner-Managed State Transitions ──────────────────────────────────────

    /**
     * @notice Mark a loan as fully repaid.
     * @dev    In production, replace with a Gateway decrypt callback that checks
     *         FHE.ge(repaidAmount, amount) on-chain without revealing values.
     */
    function markAsRepaid(address borrower) external onlyOwner {
        require(_loans[borrower].status == LoanStatus.Active, "Lending: not active");
        _loans[borrower].status = LoanStatus.Repaid;
    }

    /**
     * @notice Mark an overdue loan as defaulted.
     */
    function markAsDefaulted(address borrower) external onlyOwner {
        require(
            _loans[borrower].status == LoanStatus.Active &&
            block.timestamp > _loans[borrower].dueDate,
            "Lending: loan not overdue"
        );
        _loans[borrower].status = LoanStatus.Defaulted;
        emit LoanDefaulted(borrower);
    }

    // ─── Read Functions ───────────────────────────────────────────────────────

    /**
     * @notice Returns the caller's encrypted loan handles for client-side decryption.
     *         Only the borrower or the owner may query this.
     */
    function getMyLoan(address borrower)
        external
        view
        returns (
            euint64    amount,
            euint64    repaidAmount,
            LoanStatus status,
            uint256    dueDate
        )
    {
        require(
            msg.sender == borrower || msg.sender == owner(),
            "Lending: unauthorized"
        );
        Loan storage l = _loans[borrower];
        return (l.amount, l.repaidAmount, l.status, l.dueDate);
    }

    /**
     * @notice Returns the encrypted total loan portfolio volume.
     *         Only the bank owner may read this aggregate.
     */
    function getTotalLoanVolume() external view onlyOwner returns (euint64) {
        return _totalLoanVolume;
    }

    /// @notice Returns the plaintext loan status for a given borrower.
    function getLoanStatus(address borrower) external view returns (LoanStatus) {
        return _loans[borrower].status;
    }
}

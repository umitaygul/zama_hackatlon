// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {FHE, externalEuint64, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IConfidentialCreditScorer} from "./interfaces/IConfidentialCreditScorer.sol";
import {IConfidentialBank} from "./interfaces/IConfidentialBank.sol";

/**
 * @title ConfidentialLending
 * @notice applyForLoan içinde computeScore zorla çağrılır —
 *         her loan başvurusunda anlık bakiyeyle fresh score hesaplanır.
 */
contract ConfidentialLending is ZamaEthereumConfig, Ownable2Step {

    uint64  public constant MIN_LOAN_AMOUNT = 500e6;
    uint256 public constant LOAN_DURATION   = 30 days;

    IConfidentialCreditScorer public scorer;
    IConfidentialBank          public bank;

    enum LoanStatus { None, Active, Repaid, Defaulted }

    struct Loan {
        euint64    amount;
        LoanStatus status;
        uint256    approvedAt;
        uint256    dueDate;
    }

    mapping(address => Loan) private _loans;
    euint64 private _totalLoanVolume;

    event LoanApplied(address indexed borrower);
    event LoanRepaid(address indexed borrower);
    event LoanDefaulted(address indexed borrower);

    constructor(
        address owner_,
        address scorer_,
        address bank_
    ) Ownable(owner_) {
        scorer = IConfidentialCreditScorer(scorer_);
        bank   = IConfidentialBank(bank_);
        _totalLoanVolume = FHE.asEuint64(0);
        FHE.allowThis(_totalLoanVolume);
    }

    function applyForLoan(
        bytes32 encryptedAmount,
        bytes calldata inputProof
    ) external {
        require(bank.hasAccount(msg.sender), "Lending: no bank account");
        require(
            _loans[msg.sender].status == LoanStatus.None ||
            _loans[msg.sender].status == LoanStatus.Repaid,
            "Lending: existing active loan"
        );

        // Fresh score zorla — anlık bakiye + anlık threshold
        scorer.computeScore(msg.sender);

        // Anlık threshold ile fresh eligibility
        ebool eligible = scorer.getEligibility(msg.sender);

        euint64 requestedAmount = FHE.fromExternal(
            externalEuint64.wrap(encryptedAmount),
            inputProof
        );

        uint64 maxLoan      = scorer.getMaxLoanAmount();
        ebool withinLimit   = FHE.le(requestedAmount, FHE.asEuint64(maxLoan));

        ebool canApprove       = FHE.and(eligible, withinLimit);
        euint64 approvedAmount = FHE.select(canApprove, requestedAmount, FHE.asEuint64(0));

        _totalLoanVolume = FHE.add(_totalLoanVolume, approvedAmount);
        FHE.allowThis(_totalLoanVolume);

        _loans[msg.sender] = Loan({
            amount:     approvedAmount,
            status:     LoanStatus.Active,
            approvedAt: block.timestamp,
            dueDate:    block.timestamp + LOAN_DURATION
        });

        FHE.allowThis(approvedAmount);
        FHE.allow(approvedAmount, msg.sender);
        FHE.allow(approvedAmount, address(bank));

        bank.creditDeposit(msg.sender, approvedAmount);

        emit LoanApplied(msg.sender);
    }

    function repay() external {
        require(
            _loans[msg.sender].status == LoanStatus.Active,
            "Lending: no active loan"
        );

        Loan storage loan = _loans[msg.sender];

        FHE.allow(loan.amount, address(bank));
        bank.debitBalance(msg.sender, loan.amount);

        loan.status = LoanStatus.Repaid;

        emit LoanRepaid(msg.sender);
    }

    function markAsDefaulted(address borrower) external onlyOwner {
        require(
            _loans[borrower].status == LoanStatus.Active &&
            block.timestamp > _loans[borrower].dueDate,
            "Lending: not overdue"
        );
        _loans[borrower].status = LoanStatus.Defaulted;
        emit LoanDefaulted(borrower);
    }

    function getMyLoan(address borrower)
        external
        returns (
            euint64 amount,
            LoanStatus status,
            uint256 dueDate
        )
    {
        require(
            msg.sender == borrower || msg.sender == owner(),
            "Lending: unauthorized"
        );

        Loan storage l = _loans[borrower];

        if (l.status != LoanStatus.None) {
            FHE.allow(l.amount, borrower);
        }

        return (l.amount, l.status, l.dueDate);
    }

    function getLoanStatus(address borrower) external view returns (LoanStatus) {
        return _loans[borrower].status;
    }

    function getTotalLoanVolume() external view onlyOwner returns (euint64) {
        return _totalLoanVolume;
    }
}

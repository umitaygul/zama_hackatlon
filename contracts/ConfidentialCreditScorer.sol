// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IConfidentialBank} from "./interfaces/IConfidentialBank.sol";

contract ConfidentialCreditScorer is ZamaEthereumConfig, Ownable2Step {

    // ─── Scoring Parameters (adjustable by owner) ─────────────────────────────

    uint64 public balanceThresholdHigh  = 10_000e6;
    uint64 public balanceThresholdMed   =  5_000e6;
    uint64 public depositThresholdHigh  = 50_000e6;
    uint64 public depositThresholdMed   = 20_000e6;
    uint64 public monthsThresholdHigh   = 24;
    uint64 public monthsThresholdMed    = 12;
    uint64 public eligibilityThreshold  = 50;

    // ─── State ────────────────────────────────────────────────────────────────

    IConfidentialBank public bank;
    address           public lendingContract;

    struct CreditScore {
        euint64 score;
        ebool   isEligible;
        uint256 computedAt;
    }

    mapping(address => CreditScore) private _scores;

    // ─── Events ───────────────────────────────────────────────────────────────

    event ScoreComputed(address indexed customer, uint256 timestamp);
    event LendingContractSet(address indexed lending);
    event ScoringParametersUpdated(
        uint64 balanceHigh,
        uint64 balanceMed,
        uint64 depositHigh,
        uint64 depositMed,
        uint64 monthsHigh,
        uint64 monthsMed,
        uint64 eligibility
    );

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

    function setScoringParameters(
        uint64 balanceHigh,
        uint64 balanceMed,
        uint64 depositHigh,
        uint64 depositMed,
        uint64 monthsHigh,
        uint64 monthsMed,
        uint64 eligibility
    ) external onlyOwner {
        require(balanceMed < balanceHigh, "Scorer: invalid balance thresholds");
        require(depositMed < depositHigh, "Scorer: invalid deposit thresholds");
        require(monthsMed < monthsHigh,   "Scorer: invalid months thresholds");
        require(eligibility <= 100,        "Scorer: eligibility max 100");

        balanceThresholdHigh = balanceHigh;
        balanceThresholdMed  = balanceMed;
        depositThresholdHigh = depositHigh;
        depositThresholdMed  = depositMed;
        monthsThresholdHigh  = monthsHigh;
        monthsThresholdMed   = monthsMed;
        eligibilityThreshold = eligibility;

        emit ScoringParametersUpdated(
            balanceHigh, balanceMed,
            depositHigh, depositMed,
            monthsHigh, monthsMed,
            eligibility
        );
    }

    // ─── Score Computation ────────────────────────────────────────────────────

    function computeScore(address customer) external {
        (
            euint64 balance,
            euint64 totalDeposited,
            euint64 monthsActive
        ) = bank.getFinancialData(customer);

        // Balance Score (0 – 40 pts)
        ebool balHigh = FHE.ge(balance, FHE.asEuint64(balanceThresholdHigh));
        ebool balMed  = FHE.ge(balance, FHE.asEuint64(balanceThresholdMed));

        euint64 balanceScore = FHE.select(
            balHigh,
            FHE.asEuint64(40),
            FHE.select(balMed, FHE.asEuint64(20), FHE.asEuint64(5))
        );

        // Tenure Score (0 – 30 pts)
        ebool monthsHigh_ = FHE.ge(monthsActive, FHE.asEuint64(monthsThresholdHigh));
        ebool monthsMed_  = FHE.ge(monthsActive, FHE.asEuint64(monthsThresholdMed));

        euint64 tenureScore = FHE.select(
            monthsHigh_,
            FHE.asEuint64(30),
            FHE.select(monthsMed_, FHE.asEuint64(15), FHE.asEuint64(3))
        );

        // Deposit Volume Score (0 – 30 pts)
        ebool depHigh = FHE.ge(totalDeposited, FHE.asEuint64(depositThresholdHigh));
        ebool depMed  = FHE.ge(totalDeposited, FHE.asEuint64(depositThresholdMed));

        euint64 depositScore = FHE.select(
            depHigh,
            FHE.asEuint64(30),
            FHE.select(depMed, FHE.asEuint64(15), FHE.asEuint64(3))
        );

        // Total Score & Eligibility
        euint64 totalScore = FHE.add(FHE.add(balanceScore, tenureScore), depositScore);
        ebool   eligible   = FHE.ge(totalScore, FHE.asEuint64(eligibilityThreshold));

        _scores[customer] = CreditScore({
            score:      totalScore,
            isEligible: eligible,
            computedAt: block.timestamp
        });

        FHE.allowThis(totalScore);
        FHE.allowThis(eligible);
        FHE.allow(totalScore, customer);
        FHE.allow(eligible,   customer);
        if (lendingContract != address(0)) {
            FHE.allow(eligible, lendingContract);
        }

        emit ScoreComputed(customer, block.timestamp);
    }

    // ─── Lending Contract Access ──────────────────────────────────────────────

    function getEligibility(address customer)
        external
        onlyLending
        returns (ebool)
    {
        require(_scores[customer].computedAt > 0, "Scorer: no score computed yet");
        FHE.allow(_scores[customer].isEligible, lendingContract);
        return _scores[customer].isEligible;
    }

    // ─── Customer Access ──────────────────────────────────────────────────────

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

    function getScoreTimestamp(address customer) external view returns (uint256) {
        return _scores[customer].computedAt;
    }
}

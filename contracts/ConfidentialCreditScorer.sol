// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IConfidentialBank} from "./interfaces/IConfidentialBank.sol";

contract ConfidentialCreditScorer is ZamaEthereumConfig, Ownable2Step {

    uint64 public balanceThresholdHigh  = 10_000e6;
    uint64 public balanceThresholdMed   =  5_000e6;
    uint64 public depositThresholdHigh  = 50_000e6;
    uint64 public depositThresholdMed   = 20_000e6;
    uint64 public monthsThresholdHigh   = 24;
    uint64 public monthsThresholdMed    = 12;
    uint64 public eligibilityThreshold  = 50;
    uint64 public maxLoanAmount         = 50_000e6;

    IConfidentialBank public bank;
    address public lendingContract;

    struct CreditScore {
        euint64 score;
        ebool   isEligible;
        uint256 computedAt;
    }

    mapping(address => CreditScore) private _scores;

    event ScoreComputed(address indexed customer, uint256 timestamp);
    event LendingContractSet(address indexed lending);
    event ScoringParametersUpdated();

    modifier onlyLending() {
        require(msg.sender == lendingContract, "Scorer: caller is not lending");
        _;
    }

    constructor(address owner_, address bank_) Ownable(owner_) {
        bank = IConfidentialBank(bank_);
    }

    function setLendingContract(address lending_) external onlyOwner {
        lendingContract = lending_;
        emit LendingContractSet(lending_);
    }

    function setScoringParameters(
        uint64 balHigh,
        uint64 balMed,
        uint64 depHigh,
        uint64 depMed,
        uint64 monthsHigh,
        uint64 monthsMed,
        uint64 eligibility,
        uint64 maxLoan
    ) external onlyOwner {
        balanceThresholdHigh = balHigh;
        balanceThresholdMed  = balMed;
        depositThresholdHigh = depHigh;
        depositThresholdMed  = depMed;
        monthsThresholdHigh  = monthsHigh;
        monthsThresholdMed   = monthsMed;
        eligibilityThreshold = eligibility;
        maxLoanAmount        = maxLoan;
        emit ScoringParametersUpdated();
    }

    function computeScore(address customer) external {
        (
            euint64 balance,
            euint64 totalDeposited,
            euint64 monthsActive
        ) = bank.getFinancialData(customer);

        // Bakiye Skoru (max 40 puan)
        ebool balHigh_ = FHE.ge(balance, FHE.asEuint64(balanceThresholdHigh));
        ebool balMed_  = FHE.ge(balance, FHE.asEuint64(balanceThresholdMed));
        euint64 balanceScore = FHE.select(
            balHigh_,
            FHE.asEuint64(40),
            FHE.select(balMed_, FHE.asEuint64(20), FHE.asEuint64(5))
        );

        // Hesap Yaşı Skoru (max 30 puan)
        ebool monthsHigh_ = FHE.ge(monthsActive, FHE.asEuint64(monthsThresholdHigh));
        ebool monthsMed_  = FHE.ge(monthsActive, FHE.asEuint64(monthsThresholdMed));
        euint64 tenureScore = FHE.select(
            monthsHigh_,
            FHE.asEuint64(30),
            FHE.select(monthsMed_, FHE.asEuint64(15), FHE.asEuint64(3))
        );

        // Toplam Yatırım Skoru (max 30 puan)
        ebool depHigh_ = FHE.ge(totalDeposited, FHE.asEuint64(depositThresholdHigh));
        ebool depMed_  = FHE.ge(totalDeposited, FHE.asEuint64(depositThresholdMed));
        euint64 depositScore = FHE.select(
            depHigh_,
            FHE.asEuint64(30),
            FHE.select(depMed_, FHE.asEuint64(15), FHE.asEuint64(3))
        );

        euint64 totalScore = FHE.add(FHE.add(balanceScore, tenureScore), depositScore);
        ebool eligible     = FHE.ge(totalScore, FHE.asEuint64(eligibilityThreshold));

        _scores[customer] = CreditScore({
            score:      totalScore,
            isEligible: eligible,
            computedAt: block.timestamp
        });

        // ACL — computeScore içinde set ediliyor
        FHE.allowThis(totalScore);
        FHE.allowThis(eligible);
        FHE.allow(totalScore, customer);
        FHE.allow(eligible, customer);

        if (lendingContract != address(0)) {
            FHE.allow(eligible, lendingContract);
        }

        emit ScoreComputed(customer, block.timestamp);
    }

    function getEligibility(address customer)
        external
        onlyLending
        returns (ebool)
    {
        require(_scores[customer].computedAt > 0, "Scorer: no score computed");

        ebool freshEligible = FHE.ge(
            _scores[customer].score,
            FHE.asEuint64(eligibilityThreshold)
        );

        FHE.allowThis(freshEligible);
        FHE.allow(freshEligible, lendingContract);

        return freshEligible;
    }

    function getMaxLoanAmount() external view returns (uint64) {
        return maxLoanAmount;
    }

    /**
     * @notice view fonksiyon — FHE.allow kaldırıldı.
     *         ACL izinleri computeScore içinde zaten set ediliyor.
     *         Wallet tx imzası gerekmez — sadece read.
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
        require(_scores[customer].computedAt > 0, "Scorer: no score computed");

        CreditScore storage cs = _scores[customer];
        return (cs.score, cs.isEligible, cs.computedAt);
    }

    function getScoreTimestamp(address customer) external view returns (uint256) {
        return _scores[customer].computedAt;
    }
}
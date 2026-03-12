// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {FHE, externalEuint64, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title ConfidentialBank
 * @notice Şifreli bakiye yönetimi. Bakiyeler FHE ile şifreli tutulur,
 *         plaintext asla zincirde görünmez.
 *         CreditScorer finansal veri okuyabilir.
 *         Lending kontratı bakiyeye loan ekleyip düşebilir.
 */
contract ConfidentialBank is ZamaEthereumConfig, Ownable2Step {

    // ─── State ────────────────────────────────────────────────────────────────

    mapping(address => euint64) private _balances;
    mapping(address => bool)    public  hasAccount;
    mapping(address => euint64) private _monthsActive;
    mapping(address => euint64) private _totalDeposited;

    address public creditScorer;
    address public lendingContract;

    // ─── Events ───────────────────────────────────────────────────────────────

    event AccountOpened(address indexed customer);
    event Deposit(address indexed customer);
    event Withdraw(address indexed customer);
    event Transfer(address indexed from, address indexed to);
    event CreditScorerSet(address indexed scorer);
    event LendingContractSet(address indexed lending);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAccountHolder() {
        require(hasAccount[msg.sender], "Bank: no account");
        _;
    }

    modifier onlyCreditScorer() {
        require(msg.sender == creditScorer, "Bank: caller is not credit scorer");
        _;
    }

    modifier onlyLending() {
        require(msg.sender == lendingContract, "Bank: caller is not lending");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address owner_) Ownable(owner_) {}

    // ─── Admin ────────────────────────────────────────────────────────────────

    function setCreditScorer(address scorer_) external onlyOwner {
        creditScorer = scorer_;
        emit CreditScorerSet(scorer_);
    }

    function setLendingContract(address lending_) external onlyOwner {
        lendingContract = lending_;
        emit LendingContractSet(lending_);
    }

    // ─── Hesap Açma ───────────────────────────────────────────────────────────

    function openAccount() external {
        require(!hasAccount[msg.sender], "Bank: account already exists");

        _balances[msg.sender]       = FHE.asEuint64(0);
        _monthsActive[msg.sender]   = FHE.asEuint64(0);
        _totalDeposited[msg.sender] = FHE.asEuint64(0);
        hasAccount[msg.sender]      = true;

        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);

        emit AccountOpened(msg.sender);
    }

    // ─── Deposit ──────────────────────────────────────────────────────────────

    function deposit(
        bytes32 encryptedAmount,
        bytes calldata inputProof
    ) external onlyAccountHolder {
        euint64 amount = FHE.fromExternal(externalEuint64.wrap(encryptedAmount), inputProof);

        _balances[msg.sender]       = FHE.add(_balances[msg.sender], amount);
        _totalDeposited[msg.sender] = FHE.add(_totalDeposited[msg.sender], amount);

        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);
        FHE.allowThis(_totalDeposited[msg.sender]);
        if (creditScorer != address(0)) {
            FHE.allow(_totalDeposited[msg.sender], creditScorer);
        }

        emit Deposit(msg.sender);
    }

    // ─── Withdraw ─────────────────────────────────────────────────────────────

    function withdraw(
        bytes32 encryptedAmount,
        bytes calldata inputProof
    ) external onlyAccountHolder {
        euint64 amount     = FHE.fromExternal(externalEuint64.wrap(encryptedAmount), inputProof);
        ebool hasFunds     = FHE.ge(_balances[msg.sender], amount);
        euint64 safeAmount = FHE.select(hasFunds, amount, FHE.asEuint64(0));

        _balances[msg.sender] = FHE.sub(_balances[msg.sender], safeAmount);

        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);

        emit Withdraw(msg.sender);
    }

    // ─── Transfer ─────────────────────────────────────────────────────────────

    function transfer(
        address to,
        bytes32 encryptedAmount,
        bytes calldata inputProof
    ) external onlyAccountHolder {
        require(hasAccount[to], "Bank: recipient has no account");
        require(to != msg.sender, "Bank: self-transfer");

        euint64 amount     = FHE.fromExternal(externalEuint64.wrap(encryptedAmount), inputProof);
        ebool hasFunds     = FHE.ge(_balances[msg.sender], amount);
        euint64 safeAmount = FHE.select(hasFunds, amount, FHE.asEuint64(0));

        _balances[msg.sender] = FHE.sub(_balances[msg.sender], safeAmount);
        _balances[to]         = FHE.add(_balances[to], safeAmount);

        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        emit Transfer(msg.sender, to);
    }

    // ─── Lending Entegrasyonu ─────────────────────────────────────────────────

    function creditDeposit(address customer, euint64 amount) external onlyLending {
        require(hasAccount[customer], "Bank: no account");

        _balances[customer] = FHE.add(_balances[customer], amount);

        FHE.allowThis(_balances[customer]);
        FHE.allow(_balances[customer], customer);
        if (creditScorer != address(0)) {
            FHE.allow(_balances[customer], creditScorer);
        }
    }

    function debitBalance(address customer, euint64 amount) external onlyLending {
        require(hasAccount[customer], "Bank: no account");

        ebool hasFunds     = FHE.ge(_balances[customer], amount);
        euint64 safeAmount = FHE.select(hasFunds, amount, FHE.asEuint64(0));

        _balances[customer] = FHE.sub(_balances[customer], safeAmount);

        FHE.allowThis(_balances[customer]);
        FHE.allow(_balances[customer], customer);
        if (creditScorer != address(0)) {
            FHE.allow(_balances[customer], creditScorer);
        }
    }

    // ─── Ay Güncelleme ────────────────────────────────────────────────────────

    function incrementMonthsActive(address customer) external onlyOwner {
        require(hasAccount[customer], "Bank: no account");
        _monthsActive[customer] = FHE.add(_monthsActive[customer], FHE.asEuint64(1));
        FHE.allowThis(_monthsActive[customer]);
        if (creditScorer != address(0)) {
            FHE.allow(_monthsActive[customer], creditScorer);
        }
    }

    // ─── CreditScorer Veri Erişimi ────────────────────────────────────────────

    function getFinancialData(address customer)
        external
        onlyCreditScorer
        returns (euint64 balance, euint64 totalDeposited, euint64 monthsActive)
    {
        require(hasAccount[customer], "Bank: no account");

        FHE.allow(_balances[customer], creditScorer);
        FHE.allow(_totalDeposited[customer], creditScorer);
        FHE.allow(_monthsActive[customer], creditScorer);

        return (
            _balances[customer],
            _totalDeposited[customer],
            _monthsActive[customer]
        );
    }

    // ─── Müşteri Okuma ────────────────────────────────────────────────────────

    function getMyBalance() external view onlyAccountHolder returns (euint64) {
        return _balances[msg.sender];
    }
}

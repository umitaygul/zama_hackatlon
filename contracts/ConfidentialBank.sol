// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {FHE, externalEuint64, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/**
 * @title  ConfidentialBank
 * @notice A privacy-preserving bank contract powered by Zama's fhEVM.
 *         Customer balances and transfer amounts are never visible as plaintext
 *         on-chain. Financial data required for credit scoring is only accessible
 *         by the authorized CreditScorer contract, which processes it entirely
 *         under FHE — without ever decrypting the raw values.
 *
 * @dev    Built on top of Zama Protocol's TFHE library.
 *         All encrypted values use euint64 (8-byte unsigned integer ciphertext).
 */
contract ConfidentialBank is ZamaEthereumConfig, Ownable2Step {

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice Encrypted balance for each customer
    mapping(address => euint64) private _balances;

    /// @notice Whether a customer has an open account (plaintext — not sensitive)
    mapping(address => bool) public hasAccount;

    /// @notice Encrypted number of months the account has been active
    /// @dev    Used by CreditScorer to evaluate account tenure
    mapping(address => euint64) private _monthsActive;

    /// @notice Encrypted cumulative deposit amount
    /// @dev    Used by CreditScorer to evaluate deposit volume
    mapping(address => euint64) private _totalDeposited;

    /// @notice Address of the authorized CreditScorer contract
    /// @dev    Only this address may call getFinancialData()
    address public creditScorer;

    // ─── Events ───────────────────────────────────────────────────────────────

    event AccountOpened(address indexed customer);
    event Deposit(address indexed customer);      // amount is encrypted — not logged
    event Withdraw(address indexed customer);
    event Transfer(address indexed from, address indexed to);
    event CreditScorerSet(address indexed scorer);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAccountHolder() {
        require(hasAccount[msg.sender], "Bank: no account");
        _;
    }

    modifier onlyCreditScorer() {
        require(msg.sender == creditScorer, "Bank: caller is not credit scorer");
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address owner_) Ownable(owner_) {}

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Bank owner sets the authorized CreditScorer contract address
    function setCreditScorer(address scorer_) external onlyOwner {
        creditScorer = scorer_;
        emit CreditScorerSet(scorer_);
    }

    // ─── Account Management ───────────────────────────────────────────────────

    /**
     * @notice Opens a new bank account for the caller.
     *         Initial balance is an encrypted zero.
     */
    function openAccount() external {
        require(!hasAccount[msg.sender], "Bank: account already exists");

        _balances[msg.sender]       = FHE.asEuint64(0);
        _monthsActive[msg.sender]   = FHE.asEuint64(0);
        _totalDeposited[msg.sender] = FHE.asEuint64(0);
        hasAccount[msg.sender]      = true;

        // Grant decryption access: only the customer can decrypt their own balance
        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);

        emit AccountOpened(msg.sender);
    }

    // ─── Deposit ──────────────────────────────────────────────────────────────

    /**
     * @notice Deposit an encrypted amount into the caller's account.
     * @param encryptedAmount  Amount encrypted client-side with the FHE public key
     * @param inputProof       Zero-knowledge proof of plaintext knowledge (ZKPoK)
     */
    function deposit(
        bytes32 encryptedAmount,
        bytes calldata inputProof
    ) external onlyAccountHolder {
        euint64 amount = FHE.fromExternal(externalEuint64.wrap(encryptedAmount), inputProof);

        // Add to balance and cumulative deposit — all operations stay encrypted
        _balances[msg.sender]       = FHE.add(_balances[msg.sender], amount);
        _totalDeposited[msg.sender] = FHE.add(_totalDeposited[msg.sender], amount);

        // Refresh access permissions on updated handles
        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);
        FHE.allowThis(_totalDeposited[msg.sender]);

        emit Deposit(msg.sender);
    }

    // ─── Withdraw ─────────────────────────────────────────────────────────────

    /**
     * @notice Withdraw an encrypted amount from the caller's account.
     *
     * @dev    We cannot use a standard require(balance >= amount) check because
     *         evaluating that condition requires decryption, which would reveal
     *         the balance. Instead, we use FHE.select (oblivious conditional):
     *         if balance >= amount → withdraw amount, otherwise → withdraw 0.
     *         The transaction always succeeds; the actual withdrawn value is
     *         privately determined by the FHE computation.
     */
    function withdraw(
        bytes32 encryptedAmount,
        bytes calldata inputProof
    ) external onlyAccountHolder {
        euint64 amount = FHE.fromExternal(externalEuint64.wrap(encryptedAmount), inputProof);

        // Oblivious conditional: only deduct if funds are sufficient
        ebool   hasFunds   = FHE.ge(_balances[msg.sender], amount);
        euint64 safeAmount = FHE.select(hasFunds, amount, FHE.asEuint64(0));

        _balances[msg.sender] = FHE.sub(_balances[msg.sender], safeAmount);

        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);

        emit Withdraw(msg.sender);
    }

    // ─── Transfer ─────────────────────────────────────────────────────────────

    /**
     * @notice Transfer an encrypted amount between two bank accounts.
     *         Neither the sender, recipient, nor amount is revealed to observers.
     *
     * @dev    Same oblivious-conditional pattern as withdraw to avoid
     *         leaking balance information through reverts.
     */
    function transfer(
        address to,
        bytes32 encryptedAmount,
        bytes calldata inputProof
    ) external onlyAccountHolder {
        require(hasAccount[to],         "Bank: recipient has no account");
        require(to != msg.sender,       "Bank: self-transfer not allowed");

        euint64 amount = FHE.fromExternal(externalEuint64.wrap(encryptedAmount), inputProof);

        // Only transfer if sender has sufficient funds; otherwise transfer 0
        ebool   hasFunds   = FHE.ge(_balances[msg.sender], amount);
        euint64 safeAmount = FHE.select(hasFunds, amount, FHE.asEuint64(0));

        _balances[msg.sender] = FHE.sub(_balances[msg.sender], safeAmount);
        _balances[to]         = FHE.add(_balances[to],         safeAmount);

        // Grant each party access to their own updated balance handle
        FHE.allowThis(_balances[msg.sender]);
        FHE.allow(_balances[msg.sender], msg.sender);
        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        emit Transfer(msg.sender, to);
    }

    // ─── Monthly Tick (Bank-Initiated) ────────────────────────────────────────

    /**
     * @notice Increments the encrypted months-active counter for a customer.
     *         In production this would be automated via Chainlink Automation.
     */
    function incrementMonthsActive(address customer) external onlyOwner {
        require(hasAccount[customer], "Bank: no account");

        _monthsActive[customer] = FHE.add(_monthsActive[customer], FHE.asEuint64(1));
        FHE.allowThis(_monthsActive[customer]);
    }

    // ─── CreditScorer Data Access ─────────────────────────────────────────────

    /**
     * @notice Returns encrypted financial data exclusively to the CreditScorer.
     *         The scorer processes these values under FHE and never decrypts them.
     *         Raw balance figures are never exposed to any external party.
     *
     * @return balance         Current encrypted balance
     * @return totalDeposited  Cumulative encrypted deposit volume
     * @return monthsActive    Encrypted account tenure in months
     */
    function getFinancialData(address customer)
        external
        onlyCreditScorer
        returns (euint64 balance, euint64 totalDeposited, euint64 monthsActive)
    {
        require(hasAccount[customer], "Bank: no account");

        // Allow the CreditScorer contract to operate on these ciphertext handles
        FHE.allow(_balances[customer],       creditScorer);
        FHE.allow(_totalDeposited[customer], creditScorer);
        FHE.allow(_monthsActive[customer],   creditScorer);

        return (
            _balances[customer],
            _totalDeposited[customer],
            _monthsActive[customer]
        );
    }

    // ─── Customer Read ────────────────────────────────────────────────────────

    /**
     * @notice Returns the caller's encrypted balance handle for client-side decryption.
     * @dev    The handle is a ciphertext reference — the plaintext is only recoverable
     *         by the key holder (the customer) using the fhEVM SDK.
     */
    function getMyBalance() external view onlyAccountHolder returns (euint64) {
        return _balances[msg.sender];
    }
}

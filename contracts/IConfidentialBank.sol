// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

interface IConfidentialBank {
    function hasAccount(address customer) external view returns (bool);

    /**
     * @notice Returns encrypted financial data for credit scoring purposes.
     * @dev    Only callable by the authorized CreditScorer contract.
     *         All returned values are ciphertext handles — never plaintext.
     */
    function getFinancialData(address customer)
        external
        returns (euint64 balance, euint64 totalDeposited, euint64 monthsActive);
}

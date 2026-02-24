// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {ebool} from "@fhevm/solidity/lib/FHE.sol";

interface IConfidentialCreditScorer {
    /**
     * @notice Returns an encrypted eligibility boolean to the LendingContract.
     * @dev    Only callable by the authorized LendingContract address.
     *         The underlying score and balance values are never exposed.
     */
    function getEligibility(address customer) external returns (ebool);

    /// @notice Returns the timestamp of the last score computation (plaintext).
    function getScoreTimestamp(address customer) external view returns (uint256);
}

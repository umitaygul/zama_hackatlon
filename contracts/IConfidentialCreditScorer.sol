// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {ebool} from "@fhevm/solidity/lib/FHE.sol";

interface IConfidentialCreditScorer {
    function computeScore(address customer) external;
    function getEligibility(address customer) external returns (ebool);
    function getScoreTimestamp(address customer) external view returns (uint256);
    function getMaxLoanAmount() external view returns (uint64);
}

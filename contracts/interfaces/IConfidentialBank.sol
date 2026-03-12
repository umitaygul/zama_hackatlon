// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

interface IConfidentialBank {
    function hasAccount(address customer) external view returns (bool);
    function getFinancialData(address customer)
        external
        returns (euint64 balance, euint64 totalDeposited, euint64 monthsActive);
    function creditDeposit(address customer, euint64 amount) external;
    function debitBalance(address customer, euint64 amount) external;
}

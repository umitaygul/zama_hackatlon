const fs = require('fs');

const bank = JSON.parse(fs.readFileSync('./artifacts/contracts/ConfidentialBank.sol/ConfidentialBank.json'));
const scorer = JSON.parse(fs.readFileSync('./artifacts/contracts/ConfidentialCreditScorer.sol/ConfidentialCreditScorer.json'));
const lending = JSON.parse(fs.readFileSync('./artifacts/contracts/ConfidentialLending.sol/ConfidentialLending.json'));

const output = {
  ConfidentialBank: bank.abi,
  ConfidentialCreditScorer: scorer.abi,
  ConfidentialLending: lending.abi
};

fs.writeFileSync('../confidential-bank-frontend/src/config/abis.json', JSON.stringify(output, null, 2));
console.log('ABIs exported successfully');

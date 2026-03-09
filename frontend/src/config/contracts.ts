import abis from './abis.json';

export const CONTRACT_ADDRESSES = {
  ConfidentialBank: "0x3C4382e87E92dC3814D662B1A938958288Fe85C1",
  ConfidentialCreditScorer: "0xb51C5da0Fc124D32dF8b17068AC4b544A7Ea403c",
  ConfidentialLending: "0x8b1dD90432B891c9bfF7207d8c1AEc3DE493BAE1",
} as const;

export const CONTRACT_ABIS = {
  ConfidentialBank: abis.ConfidentialBank,
  ConfidentialCreditScorer: abis.ConfidentialCreditScorer,
  ConfidentialLending: abis.ConfidentialLending,
} as const;

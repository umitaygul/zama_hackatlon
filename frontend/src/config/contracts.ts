import abis from "./abis.json";

export const CONTRACT_ADDRESSES = {
  ConfidentialBank: "0xCf5e6eEF24B64D5EA3A7282987BA6D0bfB666357",
  ConfidentialCreditScorer: "0x4e9Bba90912C9043969e7f98a8BDc9f13E6F9285",
  ConfidentialLending: "0x651FBfD10188091f38c8837e360DdF3d2c1D40aA",
} as const;

export const CONTRACT_ABIS = {
  ConfidentialBank: abis.ConfidentialBank,
  ConfidentialCreditScorer: abis.ConfidentialCreditScorer,
  ConfidentialLending: abis.ConfidentialLending,
} as const;

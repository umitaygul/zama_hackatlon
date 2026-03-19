import abis from "./abis.json";

export const CONTRACT_ADDRESSES = {
  ConfidentialBank: "0x977cb08Ec75B9bC55541bCC1c539C57BC9C2Db9a",
  ConfidentialCreditScorer: "0x347a466DE9D85176B12b5B307968A5ED5255EBA2",
  ConfidentialLending: "0x5ea871F969adB28856d9a093FD1949F0C4930f27",
} as const;

export const CONTRACT_ABIS = {
  ConfidentialBank: abis.ConfidentialBank,
  ConfidentialCreditScorer: abis.ConfidentialCreditScorer,
  ConfidentialLending: abis.ConfidentialLending,
} as const;
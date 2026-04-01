import abis from "./abis.json";

export const CONTRACT_ADDRESSES = {
  ConfidentialBank: "0x1b374Bee037D7d6F71a982bFEC92B3d2cf94f5f6",
  ConfidentialCreditScorer: "0x4bdeF785b269F17BF6eefc4a4f170cD6AD7d876f",
  ConfidentialLending: "0xfd1C71Bd8759185cFaD10301be9A1fd1f2C02EDD",
} as const;

export const CONTRACT_ABIS = {
  ConfidentialBank: abis.ConfidentialBank,
  ConfidentialCreditScorer: abis.ConfidentialCreditScorer,
  ConfidentialLending: abis.ConfidentialLending,
} as const;

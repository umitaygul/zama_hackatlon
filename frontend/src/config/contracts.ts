import abis from "./abis.json";

export const CONTRACT_ADDRESSES = {
  ConfidentialBank: "0x499Fdb89C5D7E8130B6EA7A7a49AA8Aa8Df548CF",
  ConfidentialCreditScorer: "0xB733481A2cDEF0cbb78DCb35106970FAf1E8714B",
  ConfidentialLending: "0xfa669BBdC17b14f3bcC3752d3C6686d70a93Bcc5",
} as const;

export const CONTRACT_ABIS = {
  ConfidentialBank: abis.ConfidentialBank,
  ConfidentialCreditScorer: abis.ConfidentialCreditScorer,
  ConfidentialLending: abis.ConfidentialLending,
} as const;

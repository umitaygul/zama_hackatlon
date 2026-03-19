import { createInstance, SepoliaConfig, initSDK } from "@zama-fhe/relayer-sdk/web";

let instance: Awaited<ReturnType<typeof createInstance>> | null = null;

export async function getFhevmInstance() {
  if (instance) return instance;
  await initSDK();
  instance = await createInstance({
    ...SepoliaConfig,
    network: "https://eth-sepolia.g.alchemy.com/v2/wvNpaBCMa40xt5csZFN3a",
    relayerUrl: "https://relayer.testnet.zama.org",
  });
  return instance;
}

const toHex = (bytes: Uint8Array): `0x${string}` => {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return ("0x" + hex) as `0x${string}`;
};

export async function encryptAmount(value: number, contractAddress: string, userAddress: string) {
  const fhevm = await getFhevmInstance();
  const input = fhevm.createEncryptedInput(contractAddress, userAddress);
  input.add64(BigInt(value));
  const result = await input.encrypt();
  return {
    handle: toHex(result.handles[0]),
    inputProof: toHex(result.inputProof),
  };
}

type Signer = {
  signTypedData: (domain: any, types: any, value: any) => Promise<string>;
};

/**
 * Score + eligible + balance — tek imza.
 * Score/eligible scorer'dan, balance bank'tan direkt.
 * İki farklı kontrat ama Zama SDK tek imzayla destekliyor.
 */
export async function decryptScoreAndBalance(
  scoreHandle: `0x${string}`,
  eligibleHandle: `0x${string}`,
  balanceHandle: `0x${string}`,
  scorerContract: string,
  bankContract: string,
  userAddress: string,
  signer: Signer,
) {
  const fhevm = await getFhevmInstance();
  const keypair = fhevm.generateKeypair();

  const handleContractPairs = [
    { handle: scoreHandle,    contractAddress: scorerContract },
    { handle: eligibleHandle, contractAddress: scorerContract },
    { handle: balanceHandle,  contractAddress: bankContract },
  ];

  const contractAddresses = [scorerContract, bankContract];
  const startTimeStamp = Math.floor(Date.now() / 1000);
  const durationDays = 10;

  const eip712 = fhevm.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);

  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
    eip712.message,
  );

  const result = await fhevm.userDecrypt(
    handleContractPairs,
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    userAddress,
    startTimeStamp,
    durationDays,
  );

  return {
    score:   result[scoreHandle    as keyof typeof result] as bigint,
    eligible: result[eligibleHandle as keyof typeof result] as boolean,
    balance: result[balanceHandle  as keyof typeof result] as bigint,
  };
}

/**
 * Loan miktarını decrypt eder — ConfidentialLending contract'tan.
 */
export async function decryptLoanAmount(
  loanHandle: `0x${string}`,
  lendingContract: string,
  userAddress: string,
  signer: Signer,
) {
  const fhevm = await getFhevmInstance();
  const keypair = fhevm.generateKeypair();

  const handleContractPairs = [{ handle: loanHandle, contractAddress: lendingContract }];
  const contractAddresses = [lendingContract];
  const startTimeStamp = Math.floor(Date.now() / 1000);
  const durationDays = 10;

  const eip712 = fhevm.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);

  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
    eip712.message,
  );

  const result = await fhevm.userDecrypt(
    handleContractPairs,
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    userAddress,
    startTimeStamp,
    durationDays,
  );

  return result[loanHandle as keyof typeof result] as bigint;
}
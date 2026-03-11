import { createInstance, SepoliaConfig, initSDK } from '@zama-fhe/relayer-sdk/web'

let instance: Awaited<ReturnType<typeof createInstance>> | null = null

export async function getFhevmInstance() {
  if (instance) return instance
  await initSDK()
  instance = await createInstance({
    ...SepoliaConfig,
    network: 'https://eth-sepolia.g.alchemy.com/v2/wvNpaBCMa40xt5csZFN3a',
    relayerUrl: 'https://relayer.testnet.zama.org',
  })
  return instance
}

const toHex = (bytes: Uint8Array): `0x${string}` => {
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return ('0x' + hex) as `0x${string}`
}

export async function encryptAmount(
  value: number,
  contractAddress: string,
  userAddress: string
) {
  const fhevm = await getFhevmInstance()
  const input = fhevm.createEncryptedInput(contractAddress, userAddress)
  input.add64(BigInt(value))
  const result = await input.encrypt()
  return {
    handle: toHex(result.handles[0]),
    inputProof: toHex(result.inputProof),
  }
}

type Signer = {
  signTypedData: (domain: any, types: any, value: any) => Promise<string>
}

export async function decryptScoreAndBalance(
  scoreHandle: `0x${string}`,
  scoreContract: string,
  balanceHandle: `0x${string}`,
  balanceContract: string,
  userAddress: string,
  signer: Signer
) {
  const fhevm = await getFhevmInstance()
  const keypair = fhevm.generateKeypair()

  const handleContractPairs = [
    { handle: scoreHandle, contractAddress: scoreContract },
    { handle: balanceHandle, contractAddress: balanceContract },
  ]
  const startTimeStamp = Math.floor(Date.now() / 1000)
  const durationDays = 10
  const contractAddresses = [scoreContract, balanceContract]

  const eip712 = fhevm.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays)

  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
    eip712.message,
  )

  const result = await fhevm.userDecrypt(
    handleContractPairs,
    keypair.privateKey,
    keypair.publicKey,
    signature.replace('0x', ''),
    contractAddresses,
    userAddress,
    startTimeStamp,
    durationDays,
  )

  return {
    score: result[scoreHandle as keyof typeof result],
    balance: result[balanceHandle as keyof typeof result],
  }
}
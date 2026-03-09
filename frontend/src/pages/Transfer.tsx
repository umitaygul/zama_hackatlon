import { useState } from 'react'
import { useWriteContract, useAccount } from 'wagmi'
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from '../config/contracts'
import { encryptAmount } from '../config/fhevm'

function Transfer() {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [isEncrypting, setIsEncrypting] = useState(false)
  const { address, isConnected } = useAccount()
  const { writeContract, isPending, isSuccess, isError } = useWriteContract()

  async function handleTransfer() {
    if (!amount || !to || !address) return
    setIsEncrypting(true)
    try {
      const encrypted = await encryptAmount(
        Math.floor(parseFloat(amount) * 1_000_000),
        CONTRACT_ADDRESSES.ConfidentialBank,
        address
      )
      writeContract({
        address: CONTRACT_ADDRESSES.ConfidentialBank,
        abi: CONTRACT_ABIS.ConfidentialBank,
        functionName: 'transfer',
        args: [to, encrypted.handles[0], encrypted.inputProof],
      })
    } finally {
      setIsEncrypting(false)
    }
  }

  const busy = isPending || isEncrypting

  return (
    <div className="page">
      <h1>Transfer</h1>
      <p className="subtitle">Send funds privately — amounts stay encrypted on-chain</p>
      <div className="card">
        {!isConnected && <p className="warning">Please connect your wallet first.</p>}
        <label className="label">Recipient Address</label>
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="0x..."
        />
        <label className="label">Amount</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
        <button onClick={handleTransfer} disabled={!isConnected || busy || !amount || !to}>
          {isEncrypting ? 'Encrypting...' : isPending ? 'Transferring...' : 'Transfer'}
        </button>
        {isSuccess && <p className="success">✓ Transfer successful!</p>}
        {isError && <p className="error">✗ Something went wrong. Please try again.</p>}
      </div>
    </div>
  )
}

export default Transfer
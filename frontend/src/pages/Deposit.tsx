import { useState } from 'react'
import { useWriteContract, useAccount } from 'wagmi'
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from '../config/contracts'
import { encryptAmount } from '../config/fhevm'

function Deposit() {
  const [amount, setAmount] = useState('')
  const [isEncrypting, setIsEncrypting] = useState(false)
  const { address, isConnected } = useAccount()
  const { writeContract, isPending, isSuccess, isError } = useWriteContract()

  async function handleDeposit() {
    if (!amount || !address) return
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
        functionName: 'deposit',
        args: [encrypted.handles[0], encrypted.inputProof],
      })
    } finally {
      setIsEncrypting(false)
    }
  }

  async function handleWithdraw() {
    if (!amount || !address) return
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
        functionName: 'withdraw',
        args: [encrypted.handles[0], encrypted.inputProof],
      })
    } finally {
      setIsEncrypting(false)
    }
  }

  const busy = isPending || isEncrypting

  return (
    <div className="page">
      <h1>Deposit / Withdraw</h1>
      <p className="subtitle">Amounts are encrypted before leaving your browser</p>
      <div className="card">
        {!isConnected && <p className="warning">Please connect your wallet first.</p>}
        <label className="label">Amount</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={handleDeposit} disabled={!isConnected || busy || !amount}>
            {isEncrypting ? 'Encrypting...' : isPending ? 'Depositing...' : 'Deposit'}
          </button>
          <button className="secondary" onClick={handleWithdraw} disabled={!isConnected || busy || !amount}>
            {isEncrypting ? 'Encrypting...' : isPending ? 'Withdrawing...' : 'Withdraw'}
          </button>
        </div>
        {isSuccess && <p className="success">✓ Transaction successful!</p>}
        {isError && <p className="error">✗ Something went wrong. Please try again.</p>}
      </div>
    </div>
  )
}

export default Deposit
import { useState } from 'react'
import { useWriteContract, useAccount } from 'wagmi'
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from '../config/contracts'
import { encryptAmount } from '../config/fhevm'

function ApplyLoan() {
  const [amount, setAmount] = useState('')
  const [isEncrypting, setIsEncrypting] = useState(false)
  const { address, isConnected } = useAccount()
  const { writeContract, isPending, isSuccess, isError } = useWriteContract()

  async function handleApply() {
    if (!amount || !address) return
    setIsEncrypting(true)
    try {
      const encrypted = await encryptAmount(
        Math.floor(parseFloat(amount) * 1_000_000),
        CONTRACT_ADDRESSES.ConfidentialLending,
        address
      )
      writeContract({
        address: CONTRACT_ADDRESSES.ConfidentialLending,
        abi: CONTRACT_ABIS.ConfidentialLending,
        functionName: 'applyForLoan',
        args: [encrypted.handles[0], encrypted.inputProof],
      })
    } finally {
      setIsEncrypting(false)
    }
  }

  const busy = isPending || isEncrypting

  return (
    <div className="page">
      <h1>Apply for Loan</h1>
      <p className="subtitle">Loan eligibility is determined privately using your encrypted credit score</p>
      <div className="card">
        {!isConnected && <p className="warning">Please connect your wallet first.</p>}
        <div style={{
          background: '#1a2236',
          border: '1px solid #1e2d4a',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '24px',
          fontSize: '14px',
          color: '#64748b',
          lineHeight: '1.6'
        }}>
          💡 Your credit score is evaluated on-chain using FHE. Neither the lender nor anyone else can see your actual score — only whether you qualify.
        </div>
        <label className="label">Loan Amount</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
        <button onClick={handleApply} disabled={!isConnected || busy || !amount}>
          {isEncrypting ? 'Encrypting...' : isPending ? 'Applying...' : 'Apply for Loan'}
        </button>
        {isSuccess && <p className="success">✓ Loan application submitted!</p>}
        {isError && <p className="error">✗ Something went wrong. Please try again.</p>}
      </div>
    </div>
  )
}

export default ApplyLoan
import { useWriteContract, useAccount } from 'wagmi'
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from '../config/contracts'

function OpenAccount() {
  const { isConnected } = useAccount()
  const { writeContract, isPending, isSuccess, isError } = useWriteContract()

  function handleOpenAccount() {
    writeContract({
      address: CONTRACT_ADDRESSES.ConfidentialBank,
      abi: CONTRACT_ABIS.ConfidentialBank,
      functionName: 'openAccount',
    })
  }

  return (
    <div className="page">
      <h1>Open Account</h1>
      <p className="subtitle">Create your confidential bank account on-chain</p>
      <div className="card">
        {!isConnected && <p className="warning">Please connect your wallet first.</p>}
        <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px', lineHeight: '1.6' }}>
          Your account is protected by Fully Homomorphic Encryption. 
          Balances and transactions remain private at all times.
        </p>
        <button onClick={handleOpenAccount} disabled={!isConnected || isPending}>
          {isPending ? 'Opening...' : 'Open Account'}
        </button>
        {isSuccess && <p className="success">✓ Account opened successfully!</p>}
        {isError && <p className="error">✗ Something went wrong. Please try again.</p>}
      </div>
    </div>
  )
}

export default OpenAccount
import { useAccount, useReadContract } from 'wagmi'
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from '../config/contracts'

function CreditScore() {
  const { address, isConnected } = useAccount()

  const { data: score, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESSES.ConfidentialCreditScorer,
    abi: CONTRACT_ABIS.ConfidentialCreditScorer,
    functionName: 'getScore',
    args: [address],
    query: { enabled: !!address },
  })

  const scoreNum = score ? Number(score) : 0

  return (
    <div className="page">
      <h1>Credit Score</h1>
      <p className="subtitle">Your on-chain credit score based on encrypted balance history</p>
      <div className="card">
        {!isConnected && <p className="warning">Please connect your wallet first.</p>}
        {isLoading && <p style={{ color: '#64748b', fontSize: '14px' }}>Loading score...</p>}
        {score !== undefined && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{
              fontSize: '64px',
              fontWeight: 700,
              color: scoreNum >= 70 ? '#10b981' : scoreNum >= 40 ? '#f59e0b' : '#ef4444',
              fontFamily: 'JetBrains Mono, monospace',
              lineHeight: 1,
              marginBottom: '8px'
            }}>
              {scoreNum}
            </div>
            <div style={{ color: '#64748b', fontSize: '14px' }}>out of 100</div>
            <div style={{
              marginTop: '16px',
              height: '6px',
              background: '#1a2236',
              borderRadius: '3px',
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                width: `${scoreNum}%`,
                background: scoreNum >= 70 ? '#10b981' : scoreNum >= 40 ? '#f59e0b' : '#ef4444',
                borderRadius: '3px',
                transition: 'width 0.5s ease'
              }} />
            </div>
          </div>
        )}
        <button onClick={() => refetch()} disabled={!isConnected || isLoading}>
          {isLoading ? 'Loading...' : 'Refresh Score'}
        </button>
      </div>
    </div>
  )
}

export default CreditScore
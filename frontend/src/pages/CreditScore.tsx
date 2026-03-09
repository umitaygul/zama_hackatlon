import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from "../config/contracts";

function CreditScore() {
  const { address, isConnected } = useAccount();
  const { writeContract, isPending: isComputing } = useWriteContract();

  const {
    data: score,
    isLoading,
    refetch,
  } = useReadContract({
    address: CONTRACT_ADDRESSES.ConfidentialCreditScorer,
    abi: CONTRACT_ABIS.ConfidentialCreditScorer,
    functionName: "getScoreTimestamp",
    args: [address],
    query: { enabled: !!address },
  }) as { data: bigint | undefined; isLoading: boolean; refetch: () => void };

  function handleComputeScore() {
    if (!address) return;
    writeContract(
      {
        address: CONTRACT_ADDRESSES.ConfidentialCreditScorer,
        abi: CONTRACT_ABIS.ConfidentialCreditScorer,
        functionName: "computeScore",
        args: [address],
      },
      {
        onSuccess: () => refetch(),
      },
    );
  }

  const hasScore = score && Number(score) > 0;

  return (
    <div className="page">
      <h1>Credit Score</h1>
      <p className="subtitle">Your on-chain credit score based on encrypted balance history</p>
      <div className="card">
        {!isConnected && <p className="warning">Please connect your wallet first.</p>}

        {isLoading && (
          <div>
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-text" style={{ width: "80%" }} />
            <div className="skeleton skeleton-text" style={{ width: "60%" }} />
            <div style={{ marginTop: "16px" }}>
              <div className="skeleton skeleton-button" />
            </div>
          </div>
        )}

        {!isLoading && hasScore && (
          <div style={{ marginBottom: "24px" }}>
            <div style={{ color: "#64748b", fontSize: "13px", marginBottom: "8px" }}>
              Last computed: {new Date(Number(score) * 1000).toLocaleString()}
            </div>
            <div
              style={{
                fontSize: "13px",
                color: "#64748b",
                fontFamily: "JetBrains Mono, monospace",
                background: "#1a2236",
                padding: "12px 16px",
                borderRadius: "8px",
                marginBottom: "16px",
              }}
            >
              Score is encrypted on-chain. Connect via Zama relayer to decrypt.
            </div>
          </div>
        )}

        {!isLoading && !hasScore && isConnected && (
          <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px" }}>
            No score computed yet. Click below to compute your credit score.
          </p>
        )}

        {!isLoading && (
          <div style={{ display: "flex", gap: "12px" }}>
            <button onClick={handleComputeScore} disabled={!isConnected || isComputing}>
              {isComputing ? "Computing..." : "Compute Score"}
            </button>
            <button className="secondary" onClick={() => refetch()} disabled={!isConnected || isLoading}>
              Refresh
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default CreditScore;

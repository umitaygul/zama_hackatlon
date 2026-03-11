import { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWalletClient, useWaitForTransactionReceipt } from "wagmi";
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from "../config/contracts";
import { decryptScoreAndBalance } from "../config/fhevm";

const STORAGE_KEY_PREFIX = "confbank_score_";

function CreditScore() {
  const { address, isConnected } = useAccount();
  const { writeContract, isPending: isComputing, data: txHash } = useWriteContract();
  const { data: walletClient } = useWalletClient();

  const stored = address ? JSON.parse(localStorage.getItem(STORAGE_KEY_PREFIX + address) || "null") : null;
  const [decryptedScore, setDecryptedScore] = useState<number | null>(stored?.score ?? null);
  const [decryptedBalance, setDecryptedBalance] = useState<number | null>(stored?.balance ?? null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!address) return;
    const saved = localStorage.getItem(STORAGE_KEY_PREFIX + address);
    if (saved) {
      const parsed = JSON.parse(saved);
      setDecryptedScore(parsed.score ?? null);
      setDecryptedBalance(parsed.balance ?? null);
    } else {
      setDecryptedScore(null);
      setDecryptedBalance(null);
    }
  }, [address]);

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: scoreTimestamp, isLoading, refetch } = useReadContract({
    address: CONTRACT_ADDRESSES.ConfidentialCreditScorer,
    abi: CONTRACT_ABIS.ConfidentialCreditScorer,
    functionName: "getScoreTimestamp",
    args: [address],
    account: address,
    query: { enabled: !!address },
  }) as { data: bigint | undefined; isLoading: boolean; refetch: () => void };

  const { data: scoreData, refetch: refetchScore } = useReadContract({
    address: CONTRACT_ADDRESSES.ConfidentialCreditScorer,
    abi: CONTRACT_ABIS.ConfidentialCreditScorer,
    functionName: "getMyScore",
    args: [address],
    account: address,
    query: { enabled: !!address },
  }) as { data: any; refetch: () => void };

  const { data: balanceData, refetch: refetchBalance } = useReadContract({
    address: CONTRACT_ADDRESSES.ConfidentialBank,
    abi: CONTRACT_ABIS.ConfidentialBank,
    functionName: "getMyBalance",
    account: address,
    query: { enabled: !!address },
  }) as { data: any; refetch: () => void };

  const scoreHandle = scoreData?.[0] as `0x${string}` | undefined;
  const balanceHandle = balanceData as `0x${string}` | undefined;

  async function runDecrypt() {
    if (!address || !walletClient || !scoreHandle || !balanceHandle) return;
    setIsDecrypting(true);
    setErrorMsg("");

    const signer = {
      signTypedData: (domain: any, types: any, value: any) =>
        walletClient.signTypedData({
          domain,
          types,
          primaryType: "UserDecryptRequestVerification",
          message: value,
        }),
    };

    try {
      const result = await decryptScoreAndBalance(
        scoreHandle,
        CONTRACT_ADDRESSES.ConfidentialCreditScorer,
        balanceHandle,
        CONTRACT_ADDRESSES.ConfidentialBank,
        address,
        signer,
      );
      const score = Number(result.score);
      const balance = Number(result.balance) / 1_000_000;
      setDecryptedScore(score);
      setDecryptedBalance(balance);
      localStorage.setItem(STORAGE_KEY_PREFIX + address, JSON.stringify({ score, balance }));
    } catch (e) {
      console.error(e);
      setErrorMsg("Failed to decrypt. Please try again.");
    } finally {
      setIsDecrypting(false);
    }
  }

  async function handleComputeScore() {
    if (!address) return;
    setDecryptedScore(null);
    setDecryptedBalance(null);
    if (address) localStorage.removeItem(STORAGE_KEY_PREFIX + address);
    setErrorMsg("");
    writeContract(
      {
        address: CONTRACT_ADDRESSES.ConfidentialCreditScorer,
        abi: CONTRACT_ABIS.ConfidentialCreditScorer,
        functionName: "computeScore",
        args: [address],
      },
      {
        onSuccess: async () => {
          await refetch();
          await refetchScore();
          await refetchBalance();
          await runDecrypt();
        },
        onError: () => setErrorMsg("Failed to compute score."),
      },
    );
  }

  const hasScore = scoreTimestamp && Number(scoreTimestamp) > 0;
  const busy = isComputing || isConfirming || isDecrypting;

  const scoreColor =
    decryptedScore === null ? "#64748b" :
    decryptedScore >= 75 ? "#22c55e" :
    decryptedScore >= 50 ? "#f59e0b" : "#ef4444";

  const buttonLabel =
    isComputing ? "Waiting for wallet..." :
    isConfirming ? "Confirming..." :
    isDecrypting ? "Decrypting..." :
    "Compute Score";

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

        {!isLoading && hasScore && decryptedScore === null && (
          <div style={{
            fontSize: "13px",
            color: "#64748b",
            fontFamily: "JetBrains Mono, monospace",
            background: "#1a2236",
            padding: "12px 16px",
            borderRadius: "8px",
            marginBottom: "16px",
          }}>
            🔒 Score is encrypted on-chain. Press "Compute Score" to reveal.
          </div>
        )}

        {!isLoading && decryptedScore !== null && (
          <div style={{ display: "flex", gap: "16px", marginBottom: "24px", flexWrap: "wrap" }}>
            <div style={{
              flex: 1,
              background: "#1a2236",
              borderRadius: "12px",
              padding: "24px",
              textAlign: "center",
              border: `1px solid ${scoreColor}33`,
              minWidth: "160px",
            }}>
              <div style={{ color: "#64748b", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "8px" }}>
                Credit Score
              </div>
              <div style={{ fontSize: "56px", fontWeight: 700, color: scoreColor, fontFamily: "JetBrains Mono, monospace", lineHeight: 1 }}>
                {decryptedScore}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "6px" }}>out of 100</div>
              <div style={{ fontSize: "12px", color: scoreColor, marginTop: "10px", fontWeight: 600 }}>
                {decryptedScore >= 75 ? "✓ Excellent" : decryptedScore >= 50 ? "⚠ Good" : "✗ Below threshold"}
              </div>
            </div>

            {decryptedBalance !== null && (
              <div style={{
                flex: 1,
                background: "#1a2236",
                borderRadius: "12px",
                padding: "24px",
                textAlign: "center",
                border: "1px solid #3b82f633",
                minWidth: "160px",
              }}>
                <div style={{ color: "#64748b", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "8px" }}>
                  Balance
                </div>
                <div style={{ fontSize: "36px", fontWeight: 700, color: "#3b82f6", fontFamily: "JetBrains Mono, monospace", lineHeight: 1 }}>
                  ${decryptedBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: "12px", color: "#64748b", marginTop: "6px" }}>USDC</div>
              </div>
            )}
          </div>
        )}

        {!isLoading && !hasScore && isConnected && (
          <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px" }}>
            No score computed yet. Click below to compute your credit score.
          </p>
        )}

        {hasScore && (
          <div style={{ color: "#64748b", fontSize: "13px", marginBottom: "16px" }}>
            Last computed: {new Date(Number(scoreTimestamp) * 1000).toLocaleString()}
          </div>
        )}

        {errorMsg && <p className="error">✗ {errorMsg}</p>}

        {!isLoading && (
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <button onClick={handleComputeScore} disabled={!isConnected || busy}>
              {buttonLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default CreditScore;
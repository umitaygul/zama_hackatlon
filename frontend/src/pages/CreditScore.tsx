import { useState, useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWalletClient, useWaitForTransactionReceipt } from "wagmi";
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from "../config/contracts";
import { decryptScoreAndBalance } from "../config/fhevm";

const STORAGE_KEY_PREFIX = "confbank_score_";
const POLL_INTERVAL_MS   = 2_000;
const POLL_TIMEOUT_MS    = 60_000;

function CreditScore() {
  const { address, isConnected } = useAccount();
  const { writeContract, isPending: isComputing, data: txHash } = useWriteContract();
  const { data: walletClient } = useWalletClient();

  const stored = address ? JSON.parse(localStorage.getItem(STORAGE_KEY_PREFIX + address) || "null") : null;
  const [decryptedScore,   setDecryptedScore]   = useState<number | null>(stored?.score   ?? null);
  const [decryptedBalance, setDecryptedBalance] = useState<number | null>(stored?.balance ?? null);
  const [isDecrypting,     setIsDecrypting]     = useState(false);
  const [isPolling,        setIsPolling]        = useState(false);
  const [errorMsg,         setErrorMsg]         = useState("");

  useEffect(() => {
    if (!address) return;
    const saved = localStorage.getItem(STORAGE_KEY_PREFIX + address);
    if (saved) {
      const parsed = JSON.parse(saved);
      setDecryptedScore(parsed.score     ?? null);
      setDecryptedBalance(parsed.balance ?? null);
    } else {
      setDecryptedScore(null);
      setDecryptedBalance(null);
    }
  }, [address]);

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: eligibilityThresholdRaw } = useReadContract({
    address: CONTRACT_ADDRESSES.ConfidentialCreditScorer,
    abi: CONTRACT_ABIS.ConfidentialCreditScorer,
    functionName: "eligibilityThreshold",
    query: { enabled: true },
  });
  const eligibilityThreshold = eligibilityThresholdRaw ? Number(eligibilityThresholdRaw) : 50;

  // Eligibility anlık threshold'dan hesaplanır — cache'e yazılmaz
  const computedEligible = decryptedScore !== null ? decryptedScore >= eligibilityThreshold : null;

  const {
    data: scoreTimestamp,
    isLoading,
    refetch,
  } = useReadContract({
    address: CONTRACT_ADDRESSES.ConfidentialCreditScorer,
    abi: CONTRACT_ABIS.ConfidentialCreditScorer,
    functionName: "getScoreTimestamp",
    args: [address],
    account: address,
    query: { enabled: !!address, staleTime: 0 },
  }) as { data: bigint | undefined; isLoading: boolean; refetch: () => Promise<any> };

  // getMyScore artık view — useReadContract ile çağrılıyor, wallet tx yok
  const { data: scoreData, refetch: refetchScore } = useReadContract({
    address: CONTRACT_ADDRESSES.ConfidentialCreditScorer,
    abi: CONTRACT_ABIS.ConfidentialCreditScorer,
    functionName: "getMyScore",
    args: [address],
    account: address,
    query: {
      enabled: !!address && !!scoreTimestamp && Number(scoreTimestamp) > 0,
      staleTime: 0,
    },
  }) as { data: any; refetch: () => Promise<any> };

  // Balance handle — bank'tan direkt, her zaman güncel
  const { data: balanceHandle, refetch: refetchBalance } = useReadContract({
    address: CONTRACT_ADDRESSES.ConfidentialBank,
    abi: CONTRACT_ABIS.ConfidentialBank,
    functionName: "getMyBalance",
    account: address,
    query: { enabled: !!address, staleTime: 0 },
  }) as { data: `0x${string}` | undefined; refetch: () => Promise<any> };

  const scoreHandle   = scoreData?.[0] as `0x${string}` | undefined;
  const eligibleHandle = scoreData?.[1] as `0x${string}` | undefined;

  async function runDecrypt() {
    if (!address || !walletClient || !scoreHandle || !eligibleHandle || !balanceHandle) {
      setErrorMsg("Data not ready. Please wait a moment and try again.");
      return;
    }
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
      // Score + eligible + balance — tek imza
      const result = await decryptScoreAndBalance(
        scoreHandle,
        eligibleHandle,
        balanceHandle,
        CONTRACT_ADDRESSES.ConfidentialCreditScorer,
        CONTRACT_ADDRESSES.ConfidentialBank,
        address,
        signer,
      );

      const score          = Number(result.score);
      const balanceDecimal = Number(result.balance) / 1_000_000;

      setDecryptedScore(score);
      setDecryptedBalance(balanceDecimal);
      localStorage.setItem(
        STORAGE_KEY_PREFIX + address,
        JSON.stringify({ score, balance: balanceDecimal })
      );
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
    localStorage.removeItem(STORAGE_KEY_PREFIX + address);
    setErrorMsg("");

    const prevTimestamp = Number(scoreTimestamp ?? 0);

    writeContract(
      {
        address: CONTRACT_ADDRESSES.ConfidentialCreditScorer,
        abi: CONTRACT_ABIS.ConfidentialCreditScorer,
        functionName: "computeScore",
        args: [address],
      },
      {
        onSuccess: async () => {
          setIsPolling(true);
          const deadline = Date.now() + POLL_TIMEOUT_MS;

          while (Date.now() < deadline) {
            const result = await refetch();
            const freshTimestamp = Number(result.data ?? 0);

            if (freshTimestamp > prevTimestamp) {
              setIsPolling(false);
              await refetchScore();
              await refetchBalance();
              await runDecrypt();
              return;
            }

            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          }

          setIsPolling(false);
          setErrorMsg("Timed out waiting for chain. Please try Refresh again.");
        },
        onError: () => setErrorMsg("Failed to compute score."),
      },
    );
  }

  const hasScore = scoreTimestamp && Number(scoreTimestamp) > 0;
  const busy = isComputing || isConfirming || isPolling || isDecrypting;

  const scoreColor =
    decryptedScore === null
      ? "#64748b"
      : decryptedScore >= eligibilityThreshold + 25
        ? "#22c55e"
        : decryptedScore >= eligibilityThreshold
          ? "#f59e0b"
          : "#ef4444";

  const scoreLabel =
    decryptedScore === null
      ? ""
      : decryptedScore >= eligibilityThreshold + 25
        ? "✓ Excellent"
        : decryptedScore >= eligibilityThreshold
          ? "⚠ Good"
          : "✗ Below threshold";

  const buttonLabel = isComputing
    ? "Waiting for wallet..."
    : isConfirming
      ? "Confirming on-chain..."
      : isPolling
        ? "Waiting for chain..."
        : isDecrypting
          ? "Decrypting..."
          : "Refresh Account Data";

  return (
    <div className="page">
      <h1>My Account</h1>
      <p className="subtitle">Your encrypted financial data — decrypted only for you</p>

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

        {isPolling && (
          <div style={{
            fontSize: "13px",
            color: "#f59e0b",
            fontFamily: "JetBrains Mono, monospace",
            background: "#1a2236",
            padding: "12px 16px",
            borderRadius: "8px",
            marginBottom: "16px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}>
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
            Waiting for chain to confirm new score...
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {!isLoading && hasScore && decryptedScore === null && !busy && (
          <div style={{
            fontSize: "13px",
            color: "#64748b",
            fontFamily: "JetBrains Mono, monospace",
            background: "#1a2236",
            padding: "12px 16px",
            borderRadius: "8px",
            marginBottom: "16px",
          }}>
            🔒 Your data is encrypted on-chain. Press "Refresh Account Data" to reveal.
          </div>
        )}

        {!isLoading && decryptedScore !== null && (
          <div style={{ display: "flex", gap: "16px", marginBottom: "24px", flexWrap: "wrap" }}>

            {/* Credit Score */}
            <div style={{
              flex: 1, background: "#1a2236", borderRadius: "12px", padding: "24px",
              textAlign: "center", border: `1px solid ${scoreColor}33`, minWidth: "140px",
            }}>
              <div style={{ color: "#64748b", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "8px" }}>
                Credit Score
              </div>
              <div style={{ fontSize: "56px", fontWeight: 700, color: scoreColor, fontFamily: "JetBrains Mono, monospace", lineHeight: 1 }}>
                {decryptedScore}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "6px" }}>out of 100</div>
              <div style={{ fontSize: "12px", color: scoreColor, marginTop: "10px", fontWeight: 600 }}>
                {scoreLabel}
              </div>
            </div>

            {/* Balance — bank'tan direkt */}
            {decryptedBalance !== null && (
              <div style={{
                flex: 1, background: "#1a2236", borderRadius: "12px", padding: "24px",
                textAlign: "center", border: "1px solid #3b82f633", minWidth: "140px",
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

            {/* Loan Eligibility */}
            {computedEligible !== null && (
              <div style={{
                flex: 1, background: "#1a2236", borderRadius: "12px", padding: "24px",
                textAlign: "center", border: `1px solid ${computedEligible ? "#22c55e33" : "#ef444433"}`, minWidth: "140px",
              }}>
                <div style={{ color: "#64748b", fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "8px" }}>
                  Loan Eligibility
                </div>
                <div style={{ fontSize: "36px", fontWeight: 700, color: computedEligible ? "#22c55e" : "#ef4444", lineHeight: 1 }}>
                  {computedEligible ? "✓" : "✗"}
                </div>
                <div style={{ fontSize: "14px", color: computedEligible ? "#22c55e" : "#ef4444", marginTop: "10px", fontWeight: 600 }}>
                  {computedEligible ? "Eligible" : "Not Eligible"}
                </div>
              </div>
            )}
          </div>
        )}

        {!isLoading && !hasScore && isConnected && (
          <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px" }}>
            No account data yet. Click below to compute your credit score.
          </p>
        )}

        {hasScore && (
          <div style={{ color: "#64748b", fontSize: "13px", marginBottom: "16px" }}>
            Last updated: {new Date(Number(scoreTimestamp) * 1000).toLocaleString()}
          </div>
        )}

        {errorMsg && <p className="error">✗ {errorMsg}</p>}

        {!isLoading && (
          <button onClick={handleComputeScore} disabled={!isConnected || busy}>
            {buttonLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export default CreditScore;
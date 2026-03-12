import { useState } from "react";
import { useWriteContract, useAccount, useReadContract, useWalletClient, useWaitForTransactionReceipt } from "wagmi";
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from "../config/contracts";
import { decryptLoanAmount } from "../config/fhevm";

function Repay() {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { writeContract, isPending, data: hash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, isError } = useWaitForTransactionReceipt({ hash });

  const [decryptedLoan, setDecryptedLoan] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const { data: loanStatus, refetch: refetchStatus } = useReadContract({
    address: CONTRACT_ADDRESSES.ConfidentialLending,
    abi: CONTRACT_ABIS.ConfidentialLending,
    functionName: "getLoanStatus",
    args: [address],
    query: { enabled: !!address },
  });

  const { data: loanData } = useReadContract({
    address: CONTRACT_ADDRESSES.ConfidentialLending,
    abi: CONTRACT_ABIS.ConfidentialLending,
    functionName: "getMyLoan",
    args: [address],
    account: address,
    query: { enabled: !!address && Number(loanStatus) === 1 },
  }) as { data: any };

  const statusLabel: Record<number, { text: string; color: string }> = {
    0: { text: "No Loan", color: "#64748b" },
    1: { text: "Active", color: "#3b82f6" },
    2: { text: "Repaid", color: "#10b981" },
    3: { text: "Defaulted", color: "#ef4444" },
  };

  const status = statusLabel[Number(loanStatus ?? 0)] ?? statusLabel[0];
  const hasActiveLoan = Number(loanStatus) === 1;
  const loanAmountHandle = loanData?.[0] as `0x${string}` | undefined;

  async function handleDecryptLoan() {
    if (!address || !walletClient || !loanAmountHandle) {
      setErrorMsg("Loan data not ready. Please wait.");
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
      const amount = await decryptLoanAmount(loanAmountHandle, CONTRACT_ADDRESSES.ConfidentialLending, address, signer);
      setDecryptedLoan(Number(amount) / 1_000_000);
    } catch (e) {
      console.error(e);
      setErrorMsg("Failed to decrypt loan amount.");
    } finally {
      setIsDecrypting(false);
    }
  }

  function handleRepay() {
    if (!address) return;
    setErrorMsg("");
    writeContract(
      {
        address: CONTRACT_ADDRESSES.ConfidentialLending,
        abi: CONTRACT_ABIS.ConfidentialLending,
        functionName: "repay",
        args: [],
      },
      {
        onSuccess: async () => {
          setDecryptedLoan(null);
          await refetchStatus();
        },
        onError: () => setErrorMsg("Repayment failed. Make sure you have an active loan."),
      },
    );
  }

  const busy = isPending || isConfirming || isDecrypting;

  return (
    <div className="page">
      <h1>Repay Loan</h1>
      <p className="subtitle">Repay your active loan in full — amount is encrypted on-chain</p>

      <div className="card">
        {!isConnected && <p className="warning">Please connect your wallet first.</p>}

        {isConnected && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "24px",
              padding: "12px 16px",
              background: "#1a2236",
              borderRadius: "8px",
              border: "1px solid #1e2d4a",
            }}
          >
            <span style={{ color: "#64748b", fontSize: "13px" }}>Loan Status:</span>
            <span
              style={{
                color: status.color,
                fontSize: "13px",
                fontWeight: 600,
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              {status.text}
            </span>
          </div>
        )}

        {hasActiveLoan && (
          <div
            style={{
              background: "#1a2236",
              borderRadius: "12px",
              padding: "20px 24px",
              marginBottom: "24px",
              border: "1px solid #3b82f633",
            }}
          >
            <div
              style={{
                color: "#64748b",
                fontSize: "11px",
                letterSpacing: "2px",
                textTransform: "uppercase",
                marginBottom: "12px",
              }}
            >
              Loan Amount
            </div>
            {decryptedLoan !== null ? (
              <div
                style={{ fontSize: "36px", fontWeight: 700, color: "#3b82f6", fontFamily: "JetBrains Mono, monospace" }}
              >
                ${decryptedLoan.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span style={{ fontSize: "14px", color: "#64748b", marginLeft: "8px" }}>USDC</span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{ color: "#64748b", fontSize: "14px", fontFamily: "JetBrains Mono, monospace" }}>
                  🔒 Encrypted on-chain
                </span>
                <button
                  onClick={handleDecryptLoan}
                  disabled={busy || !loanAmountHandle}
                  style={{ padding: "6px 14px", fontSize: "12px" }}
                >
                  {isDecrypting ? "Decrypting..." : "Reveal Amount"}
                </button>
              </div>
            )}
          </div>
        )}

        {!hasActiveLoan && isConnected && (
          <p className="warning" style={{ marginBottom: "16px" }}>
            No active loan found. Apply for a loan first.
          </p>
        )}

        {errorMsg && <p className="error">✗ {errorMsg}</p>}

        <button onClick={handleRepay} disabled={!isConnected || busy || !hasActiveLoan}>
          {isPending ? "Waiting for wallet..." : isConfirming ? "Confirming..." : "Repay Loan"}
        </button>

        {isSuccess && <p className="success">✓ Loan repaid successfully!</p>}
        {isError && !errorMsg && <p className="error">✗ Repayment failed. Please try again.</p>}

        <div
          style={{
            marginTop: "16px",
            padding: "12px",
            background: "#1a2236",
            borderRadius: "8px",
            fontSize: "12px",
            color: "#64748b",
          }}
        >
          ℹ️ Repayment covers the full loan amount. The encrypted amount will be deducted from your bank balance
          automatically.
        </div>
      </div>
    </div>
  );
}

export default Repay;

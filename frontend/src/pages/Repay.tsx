import { useState } from "react";
import { useWriteContract, useAccount, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from "../config/contracts";
import { encryptAmount } from "../config/fhevm";

function Repay() {
  const [amount, setAmount] = useState("");
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const { address, isConnected } = useAccount();

  const { writeContract, isPending, data: hash } = useWriteContract();

  const { isLoading: isConfirming, isSuccess, isError } = useWaitForTransactionReceipt({ hash });

  const { data: loanStatus } = useReadContract({
    address: CONTRACT_ADDRESSES.ConfidentialLending,
    abi: CONTRACT_ABIS.ConfidentialLending,
    functionName: "getLoanStatus",
    args: [address],
    query: { enabled: !!address },
  });

  const statusLabel: Record<number, { text: string; color: string }> = {
    0: { text: "No Loan", color: "#64748b" },
    1: { text: "Active", color: "#3b82f6" },
    2: { text: "Repaid", color: "#10b981" },
    3: { text: "Defaulted", color: "#ef4444" },
  };

  const status = statusLabel[Number(loanStatus ?? 0)] ?? statusLabel[0];
  const hasActiveLoan = Number(loanStatus) === 1;

  async function handleRepay() {
    if (!amount || !address) return;
    setErrorMsg("");
    setIsEncrypting(true);
    try {
      const encrypted = await encryptAmount(
        Math.floor(parseFloat(amount) * 1_000_000),
        CONTRACT_ADDRESSES.ConfidentialLending,
        address,
      );
      writeContract(
        {
          address: CONTRACT_ADDRESSES.ConfidentialLending,
          abi: CONTRACT_ABIS.ConfidentialLending,
          functionName: "repay",
          args: [encrypted.handle, encrypted.inputProof],
        },
        {
          onError: () => {
            setErrorMsg("Repayment failed. Make sure you have an active loan.");
          },
        },
      );
    } finally {
      setIsEncrypting(false);
    }
  }

  const busy = isPending || isConfirming || isEncrypting;

  return (
    <div className="page">
      <h1>Repay Loan</h1>
      <p className="subtitle">Make encrypted repayments toward your active loan</p>
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

        {!hasActiveLoan && isConnected && (
          <p className="warning" style={{ marginBottom: "16px" }}>
            No active loan found. Apply for a loan first.
          </p>
        )}

        <label className="label">Repayment Amount</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          disabled={!hasActiveLoan}
        />
        <button onClick={handleRepay} disabled={!isConnected || busy || !amount || !hasActiveLoan}>
          {isEncrypting ? "Encrypting..." : isPending ? "Waiting..." : isConfirming ? "Confirming..." : "Repay"}
        </button>
        {isSuccess && <p className="success">✓ Repayment submitted successfully!</p>}
        {isError && <p className="error">✗ {errorMsg || "Repayment failed. Please try again."}</p>}
      </div>
    </div>
  );
}

export default Repay;

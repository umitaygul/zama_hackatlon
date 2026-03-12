import { useState } from "react";
import { useWriteContract, useAccount, useWaitForTransactionReceipt } from "wagmi";
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from "../config/contracts";

function OpenAccount() {
  const { isConnected } = useAccount();
  const [errorMsg, setErrorMsg] = useState("");

  const { writeContract, isPending, data: hash } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess,
    isError,
    error: txError,
  } = useWaitForTransactionReceipt({ hash });

  function handleOpenAccount() {
    setErrorMsg("");
    writeContract(
      {
        address: CONTRACT_ADDRESSES.ConfidentialBank,
        abi: CONTRACT_ABIS.ConfidentialBank,
        functionName: "openAccount",
      },
      {
        onError: (error) => {
          console.log('openAccount onError:', error)
          const msg = (error.message || "").toLowerCase()
          if (msg.includes("already") || msg.includes("exists")) {
            setErrorMsg("You already have an account.")
          } else {
            setErrorMsg("Transaction failed. Please try again.")
          }
        },
      },
    );
  }

  const getErrorMessage = () => {
    if (errorMsg) return errorMsg;
    const msg = (txError?.message || "").toLowerCase();
    if (msg.includes("already") || msg.includes("exists")) {
      return "You already have an account.";
    }
    return "Transaction failed. Please try again.";
  };

  const busy = isPending || isConfirming;

  return (
    <div className="page">
      <h1>Open Account</h1>
      <p className="subtitle">Create your confidential bank account on-chain</p>
      <div className="card">
        {!isConnected && <p className="warning">Please connect your wallet first.</p>}
        <p style={{ color: "#64748b", fontSize: "14px", marginBottom: "24px", lineHeight: "1.6" }}>
          Your account is protected by Fully Homomorphic Encryption. Balances and transactions remain private at all times.
        </p>
        <button onClick={handleOpenAccount} disabled={!isConnected || busy}>
          {isPending ? "Waiting for signature..." : isConfirming ? "Confirming..." : "Open Account"}
        </button>
        {isSuccess && <p className="success">✓ Account opened successfully!</p>}
        {isError && <p className="error">✗ {getErrorMessage()}</p>}
      </div>
    </div>
  );
}

export default OpenAccount;
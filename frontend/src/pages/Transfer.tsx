import { useState } from "react";
import { useWriteContract, useAccount, useWaitForTransactionReceipt } from "wagmi";
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from "../config/contracts";
import { encryptAmount } from "../config/fhevm";

function Transfer() {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const { address, isConnected } = useAccount();

  const { writeContract, isPending, data: hash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, isError, error: txError } = useWaitForTransactionReceipt({ hash });

  function parseError(error: any): string {
    const msg = (error?.message || error?.shortMessage || "").toLowerCase();
    if (msg.includes("self-transfer")) return "You cannot transfer to yourself.";
    if (msg.includes("recipient has no account")) return "Recipient does not have an account.";
    if (msg.includes("no account")) return "You do not have a bank account.";
    return "Transfer failed. Please try again.";
  }

  async function handleTransfer() {
    if (!amount || !to || !address) return;
    setErrorMsg("");
    setIsEncrypting(true);
    try {
      const encrypted = await encryptAmount(
        Math.floor(parseFloat(amount) * 1_000_000),
        CONTRACT_ADDRESSES.ConfidentialBank,
        address,
      );
      writeContract(
        {
          address: CONTRACT_ADDRESSES.ConfidentialBank,
          abi: CONTRACT_ABIS.ConfidentialBank,
          functionName: "transfer",
          args: [to, encrypted.handle, encrypted.inputProof],
        },
        {
          onError: (error) => {
            setErrorMsg(parseError(error));
          },
        },
      );
    } finally {
      setIsEncrypting(false);
    }
  }

  const busy = isPending || isConfirming || isEncrypting;
  const displayError = errorMsg || (isError ? parseError(txError) : "");

  return (
    <div className="page">
      <h1>Transfer</h1>
      <p className="subtitle">Send funds privately — amounts stay encrypted on-chain</p>
      <div className="card">
        {!isConnected && <p className="warning">Please connect your wallet first.</p>}
        <label className="label">Recipient Address</label>
        <input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x..." />
        <label className="label">Amount</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        <button onClick={handleTransfer} disabled={!isConnected || busy || !amount || !to}>
          {isEncrypting ? "Encrypting..." : isPending ? "Waiting..." : isConfirming ? "Confirming..." : "Transfer"}
        </button>
        {isSuccess && <p className="success">✓ Transfer successful!</p>}
        {displayError && <p className="error">✗ {displayError}</p>}
        <p style={{ color: "#64748b", fontSize: "12px", marginTop: "16px", lineHeight: "1.6" }}>
          ⚠ Due to the nature of FHE, if your balance is insufficient, the transaction will still succeed but no funds will be transferred. Please verify your balance on the My Account page.
        </p>
      </div>
    </div>
  );
}

export default Transfer;
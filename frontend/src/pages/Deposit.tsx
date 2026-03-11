import { useState } from "react";
import { useWriteContract, useAccount, useWaitForTransactionReceipt } from "wagmi";
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from "../config/contracts";
import { encryptAmount } from "../config/fhevm";

function Deposit() {
  const [amount, setAmount] = useState("");
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const { address, isConnected } = useAccount();

  const { writeContract, isPending, data: hash } = useWriteContract();

  const { isLoading: isConfirming, isSuccess, isError } = useWaitForTransactionReceipt({ hash });

  async function handleDeposit() {
    if (!amount || !address) return;
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
          functionName: "deposit",
          args: [encrypted.handle, encrypted.inputProof],
        },
        {
          onError: (err) => {
            console.log('writeContract error', err)
            setErrorMsg("Deposit failed. Make sure you have an account.")
          },
        },
      );
    } finally {
      setIsEncrypting(false);
    }
  }

  async function handleWithdraw() {
    if (!amount || !address) return;
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
          functionName: "withdraw",
          args: [encrypted.handle, encrypted.inputProof],
        },
        {
          onError: (err) => {
            console.log('writeContract error', err)
            setErrorMsg("Withdrawal failed. Make sure you have sufficient balance.")
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
      <h1>Deposit / Withdraw</h1>
      <p className="subtitle">Amounts are encrypted before leaving your browser</p>
      <div className="card">
        {!isConnected && <p className="warning">Please connect your wallet first.</p>}
        <label className="label">Amount</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        <div style={{ display: "flex", gap: "12px" }}>
          <button onClick={handleDeposit} disabled={!isConnected || busy || !amount}>
            {isEncrypting ? "Encrypting..." : isPending ? "Waiting..." : isConfirming ? "Confirming..." : "Deposit"}
          </button>
          <button className="secondary" onClick={handleWithdraw} disabled={!isConnected || busy || !amount}>
            {isEncrypting ? "Encrypting..." : isPending ? "Waiting..." : isConfirming ? "Confirming..." : "Withdraw"}
          </button>
        </div>
        {isSuccess && <p className="success">✓ Transaction successful!</p>}
        {isError && <p className="error">✗ {errorMsg || "Transaction failed. Please try again."}</p>}
      </div>
    </div>
  );
}

export default Deposit;
import { useState } from "react";
import { useWriteContract, useAccount, useReadContracts, useWaitForTransactionReceipt } from "wagmi";
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from "../config/contracts";

function AdminPanel() {
  const { address, isConnected } = useAccount();
  const { writeContract, isPending, data: hash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, isError } = useWaitForTransactionReceipt({ hash });

  const [params, setParams] = useState({
    balanceHigh: "10000",
    balanceMed: "5000",
    depositHigh: "50000",
    depositMed: "20000",
    monthsHigh: "24",
    monthsMed: "12",
    eligibility: "50",
    maxLoan: "50000",
  });

  const [loaded, setLoaded] = useState(false);

  const contractConfig = {
    address: CONTRACT_ADDRESSES.ConfidentialCreditScorer,
    abi: CONTRACT_ABIS.ConfidentialCreditScorer,
  } as const;

  const { data: currentParams } = useReadContracts({
    contracts: [
      { ...contractConfig, functionName: "balanceThresholdHigh" },
      { ...contractConfig, functionName: "balanceThresholdMed" },
      { ...contractConfig, functionName: "depositThresholdHigh" },
      { ...contractConfig, functionName: "depositThresholdMed" },
      { ...contractConfig, functionName: "monthsThresholdHigh" },
      { ...contractConfig, functionName: "monthsThresholdMed" },
      { ...contractConfig, functionName: "eligibilityThreshold" },
      { ...contractConfig, functionName: "maxLoanAmount" },
    ],
  });

  if (!loaded && currentParams && currentParams[0].result !== undefined) {
    setLoaded(true);
    setParams({
      balanceHigh: (Number(currentParams[0].result) / 1_000_000).toString(),
      balanceMed: (Number(currentParams[1].result) / 1_000_000).toString(),
      depositHigh: (Number(currentParams[2].result) / 1_000_000).toString(),
      depositMed: (Number(currentParams[3].result) / 1_000_000).toString(),
      monthsHigh: Number(currentParams[4].result).toString(),
      monthsMed: Number(currentParams[5].result).toString(),
      eligibility: Number(currentParams[6].result).toString(),
      maxLoan: (Number(currentParams[7].result) / 1_000_000).toString(),
    });
  }

  function handleChange(key: string, value: string) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  function handleUpdate() {
    if (!address) return;
    writeContract({
      address: CONTRACT_ADDRESSES.ConfidentialCreditScorer,
      abi: CONTRACT_ABIS.ConfidentialCreditScorer,
      functionName: "setScoringParameters",
      args: [
        BigInt(Math.floor(parseFloat(params.balanceHigh) * 1_000_000)),
        BigInt(Math.floor(parseFloat(params.balanceMed) * 1_000_000)),
        BigInt(Math.floor(parseFloat(params.depositHigh) * 1_000_000)),
        BigInt(Math.floor(parseFloat(params.depositMed) * 1_000_000)),
        BigInt(params.monthsHigh),
        BigInt(params.monthsMed),
        BigInt(params.eligibility),
        BigInt(Math.floor(parseFloat(params.maxLoan) * 1_000_000)),
      ],
    });
  }

  const fields = [
    { key: "balanceHigh", label: "Balance Threshold High (USDC)", hint: "Score: 40 pts" },
    { key: "balanceMed", label: "Balance Threshold Med (USDC)", hint: "Score: 20 pts" },
    { key: "depositHigh", label: "Deposit Threshold High (USDC)", hint: "Score: 30 pts" },
    { key: "depositMed", label: "Deposit Threshold Med (USDC)", hint: "Score: 15 pts" },
    { key: "monthsHigh", label: "Months Active Threshold High", hint: "Score: 30 pts" },
    { key: "monthsMed", label: "Months Active Threshold Med", hint: "Score: 15 pts" },
    { key: "eligibility", label: "Eligibility Threshold (0-100)", hint: "Min score for loan" },
    { key: "maxLoan", label: "Max Loan Amount (USDC)", hint: "Per-user loan limit" },
  ];

  const busy = isPending || isConfirming;

  return (
    <div className="page">
      <h1>Scoring Policy</h1>
      <p className="subtitle">Adjust credit scoring parameters — only contract owner can execute</p>
      <div className="card">
        {!isConnected && <p className="warning">Please connect your wallet first.</p>}

        <div
          style={{
            background: "#1a2236",
            border: "1px solid #1e2d4a",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "24px",
            fontSize: "14px",
            color: "#64748b",
            lineHeight: "1.6",
          }}
        >
          ⚠️ Only the contract owner can update these parameters. Tightening the eligibility threshold makes loans
          harder to obtain — loosening makes them easier.
        </div>

        {!loaded && (
          <div>
            {[...Array(8)].map((_, i) => (
              <div key={i}>
                <div className="skeleton skeleton-text" style={{ width: "40%", marginBottom: "6px" }} />
                <div className="skeleton skeleton-input" />
              </div>
            ))}
          </div>
        )}

        {loaded &&
          fields.map((field) => (
            <div key={field.key}>
              <label className="label">
                {field.label}
                <span style={{ color: "#3b82f6", fontSize: "11px", marginLeft: "8px", fontWeight: 400 }}>
                  {field.hint}
                </span>
              </label>
              <input
                type="number"
                value={params[field.key as keyof typeof params]}
                onChange={(e) => handleChange(field.key, e.target.value)}
                disabled={busy}
              />
            </div>
          ))}

        {loaded && (
          <>
            <button onClick={handleUpdate} disabled={!isConnected || busy}>
              {isPending ? "Waiting for wallet..." : isConfirming ? "Confirming..." : "Update Parameters"}
            </button>
            {isSuccess && <p className="success">✓ Parameters updated successfully!</p>}
            {isError && <p className="error">✗ Failed. Make sure you are the contract owner.</p>}
          </>
        )}
      </div>
    </div>
  );
}

export default AdminPanel;

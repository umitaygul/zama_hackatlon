import { useState } from "react";
import { useWriteContract, useAccount, useReadContracts } from "wagmi";
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from "../config/contracts";

function AdminPanel() {
  const { address, isConnected } = useAccount();
  const { writeContract, isPending, isSuccess, isError } = useWriteContract();

  const [params, setParams] = useState({
    balanceHigh: "10000",
    balanceMed: "5000",
    depositHigh: "50000",
    depositMed: "20000",
    monthsHigh: "24",
    monthsMed: "12",
    eligibility: "50",
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
      ],
    });
  }

  const fields = [
    { key: "balanceHigh", label: "Balance Threshold High (USDC)" },
    { key: "balanceMed", label: "Balance Threshold Med (USDC)" },
    { key: "depositHigh", label: "Deposit Threshold High (USDC)" },
    { key: "depositMed", label: "Deposit Threshold Med (USDC)" },
    { key: "monthsHigh", label: "Months Threshold High" },
    { key: "monthsMed", label: "Months Threshold Med" },
    { key: "eligibility", label: "Eligibility Threshold (0-100)" },
  ];

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
            {[...Array(7)].map((_, i) => (
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
              <label className="label">{field.label}</label>
              <input
                type="number"
                value={params[field.key as keyof typeof params]}
                onChange={(e) => handleChange(field.key, e.target.value)}
              />
            </div>
          ))}

        {loaded && (
          <>
            <button onClick={handleUpdate} disabled={!isConnected || isPending}>
              {isPending ? "Updating..." : "Update Parameters"}
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

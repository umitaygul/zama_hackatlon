import { ethers } from "hardhat";

/**
 * Deployment script for the Confidential Bank & Credit Scoring system.
 *
 * Deployment order matters — contracts reference each other:
 *
 *   1. ConfidentialBank
 *   2. ConfidentialCreditScorer  (needs Bank address)
 *   3. ConfidentialLending       (needs Scorer + Bank addresses)
 *   4. Bank.setCreditScorer()    (wire Scorer → Bank)
 *   5. Scorer.setLendingContract() (wire Lending → Scorer)
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Confidential Bank & Credit Scoring — Deployment");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Deployer : ${deployer.address}`);
  console.log(
    `  Balance  : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`
  );
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── Step 1: Deploy ConfidentialBank ────────────────────────────────────────
  console.log("📦 [1/5] Deploying ConfidentialBank...");

  const BankFactory = await ethers.getContractFactory("ConfidentialBank");
  const bank = await BankFactory.deploy(deployer.address);
  await bank.waitForDeployment();

  const bankAddress = await bank.getAddress();
  console.log(`   ✅ ConfidentialBank deployed at: ${bankAddress}\n`);

  // ── Step 2: Deploy ConfidentialCreditScorer ────────────────────────────────
  console.log("📦 [2/5] Deploying ConfidentialCreditScorer...");

  const ScorerFactory = await ethers.getContractFactory("ConfidentialCreditScorer");
  const scorer = await ScorerFactory.deploy(deployer.address, bankAddress);
  await scorer.waitForDeployment();

  const scorerAddress = await scorer.getAddress();
  console.log(`   ✅ ConfidentialCreditScorer deployed at: ${scorerAddress}\n`);

  // ── Step 3: Deploy ConfidentialLending ────────────────────────────────────
  console.log("📦 [3/5] Deploying ConfidentialLending...");

  const LendingFactory = await ethers.getContractFactory("ConfidentialLending");
  const lending = await LendingFactory.deploy(
    deployer.address,
    scorerAddress,
    bankAddress
  );
  await lending.waitForDeployment();

  const lendingAddress = await lending.getAddress();
  console.log(`   ✅ ConfidentialLending deployed at: ${lendingAddress}\n`);

  // ── Step 4: Wire Bank → Scorer ────────────────────────────────────────────
  console.log("🔗 [4/5] Wiring: Bank.setCreditScorer()...");

  const tx1 = await bank.setCreditScorer(scorerAddress);
  await tx1.wait();
  console.log(`   ✅ Bank now accepts data requests from Scorer\n`);

  // ── Step 5: Wire Scorer → Lending ─────────────────────────────────────────
  console.log("🔗 [5/5] Wiring: Scorer.setLendingContract()...");

  const tx2 = await scorer.setLendingContract(lendingAddress);
  await tx2.wait();
  console.log(`   ✅ Scorer now accepts eligibility requests from Lending\n`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Deployment complete. Contract addresses:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  ConfidentialBank          : ${bankAddress}`);
  console.log(`  ConfidentialCreditScorer  : ${scorerAddress}`);
  console.log(`  ConfidentialLending       : ${lendingAddress}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // ── Persist addresses for tests and frontend ──────────────────────────────
  const fs = await import("fs");
  const deployedAddresses = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    contracts: {
      ConfidentialBank: bankAddress,
      ConfidentialCreditScorer: scorerAddress,
      ConfidentialLending: lendingAddress,
    },
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    "deployed-addresses.json",
    JSON.stringify(deployedAddresses, null, 2)
  );
  console.log("  📄 Addresses saved to deployed-addresses.json");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});

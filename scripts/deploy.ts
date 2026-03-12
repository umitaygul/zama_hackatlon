import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // ── 1. ConfidentialBank ───────────────────────────────────────────────────
  console.log("\n[1/6] Deploying ConfidentialBank...");
  const BankFactory = await ethers.getContractFactory("ConfidentialBank");
  const bank = await BankFactory.deploy(deployer.address);
  await bank.waitForDeployment();
  const bankAddr = await bank.getAddress();
  console.log("  ConfidentialBank:", bankAddr);

  // ── 2. ConfidentialCreditScorer ───────────────────────────────────────────
  console.log("\n[2/6] Deploying ConfidentialCreditScorer...");
  const ScorerFactory = await ethers.getContractFactory("ConfidentialCreditScorer");
  const scorer = await ScorerFactory.deploy(deployer.address, bankAddr);
  await scorer.waitForDeployment();
  const scorerAddr = await scorer.getAddress();
  console.log("  ConfidentialCreditScorer:", scorerAddr);

  // ── 3. ConfidentialLending ────────────────────────────────────────────────
  console.log("\n[3/6] Deploying ConfidentialLending...");
  const LendingFactory = await ethers.getContractFactory("ConfidentialLending");
  const lending = await LendingFactory.deploy(deployer.address, scorerAddr, bankAddr);
  await lending.waitForDeployment();
  const lendingAddr = await lending.getAddress();
  console.log("  ConfidentialLending:", lendingAddr);

  // ── 4. Bank → CreditScorer bağlantısı ────────────────────────────────────
  console.log("\n[4/6] Bank.setCreditScorer...");
  const tx4 = await bank.setCreditScorer(scorerAddr);
  await tx4.wait();
  console.log("  Done");

  // ── 5. Bank → Lending bağlantısı ─────────────────────────────────────────
  console.log("\n[5/6] Bank.setLendingContract...");
  const tx5 = await bank.setLendingContract(lendingAddr);
  await tx5.wait();
  console.log("  Done");

  // ── 6. Scorer → Lending bağlantısı ───────────────────────────────────────
  console.log("\n[6/6] Scorer.setLendingContract...");
  const tx6 = await scorer.setLendingContract(lendingAddr);
  await tx6.wait();
  console.log("  Done");

  // ── Sonuç ─────────────────────────────────────────────────────────────────
  const addresses = {
    ConfidentialBank: bankAddr,
    ConfidentialCreditScorer: scorerAddr,
    ConfidentialLending: lendingAddr,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    "deployed-addresses.json",
    JSON.stringify(addresses, null, 2)
  );

  console.log("\n✅ All contracts deployed and wired!");
  console.log(JSON.stringify(addresses, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

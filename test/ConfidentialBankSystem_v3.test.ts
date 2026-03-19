import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("ConfidentialBankSystem v3", function () {

  let bank: any, scorer: any, lending: any;
  let owner: HardhatEthersSigner, alice: HardhatEthersSigner, bob: HardhatEthersSigner;
  let bankAddress: string, scorerAddress: string, lendingAddress: string;

  async function encryptForBank(value: bigint, signer: HardhatEthersSigner) {
    return fhevm.createEncryptedInput(bankAddress, signer.address).add64(value).encrypt();
  }

  async function encryptForLending(value: bigint, signer: HardhatEthersSigner) {
    return fhevm.createEncryptedInput(lendingAddress, signer.address).add64(value).encrypt();
  }

  async function decryptU64(handle: any, contractAddress: string, signer: HardhatEthersSigner): Promise<bigint> {
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, signer);
  }

  async function decryptBool(handle: any, contractAddress: string, signer: HardhatEthersSigner): Promise<boolean> {
    return fhevm.userDecryptEbool(handle, contractAddress, signer);
  }

  before(async function () {
    if (!fhevm.isMock) { this.skip(); }
  });

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();

    bank = await (await ethers.getContractFactory("ConfidentialBank")).deploy(owner.address);
    await bank.waitForDeployment();
    bankAddress = await bank.getAddress();

    scorer = await (await ethers.getContractFactory("ConfidentialCreditScorer")).deploy(owner.address, bankAddress);
    await scorer.waitForDeployment();
    scorerAddress = await scorer.getAddress();

    lending = await (await ethers.getContractFactory("ConfidentialLending")).deploy(owner.address, scorerAddress, bankAddress);
    await lending.waitForDeployment();
    lendingAddress = await lending.getAddress();

    await (await bank.setCreditScorer(scorerAddress)).wait();
    await (await bank.setLendingContract(lendingAddress)).wait();
    await (await scorer.setLendingContract(lendingAddress)).wait();
  });

  // Eligible alice: 25,000 USDC → score = 40+15+3 = 58 >= 50 → eligible
  async function setupEligibleAlice() {
    await (await bank.connect(alice).openAccount()).wait();
    const enc = await encryptForBank(25_000_000_000n, alice);
    await (await bank.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
    await (await scorer.connect(alice).computeScore(alice.address)).wait();
  }

  // ── BANK ──────────────────────────────────────────────────────────────────

  describe("Bank: Account", function () {
    it("should open account", async function () {
      await (await bank.connect(alice).openAccount()).wait();
      expect(await bank.hasAccount(alice.address)).to.be.true;
    });

    it("should revert duplicate account", async function () {
      await (await bank.connect(alice).openAccount()).wait();
      await expect(bank.connect(alice).openAccount())
        .to.be.revertedWith("Bank: account already exists");
    });

    it("should initialise balance to zero", async function () {
      await (await bank.connect(alice).openAccount()).wait();
      const handle = await bank.connect(alice).getMyBalance();
      expect(await decryptU64(handle, bankAddress, alice)).to.equal(0n);
    });
  });

  describe("Bank: Deposit", function () {
    beforeEach(async () => { await (await bank.connect(alice).openAccount()).wait(); });

    it("should increase balance after deposit", async function () {
      const enc = await encryptForBank(5_000_000_000n, alice);
      await (await bank.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
      const handle = await bank.connect(alice).getMyBalance();
      expect(await decryptU64(handle, bankAddress, alice)).to.equal(5_000_000_000n);
    });

    it("should accumulate multiple deposits", async function () {
      const enc1 = await encryptForBank(3_000_000_000n, alice);
      await (await bank.connect(alice).deposit(enc1.handles[0], enc1.inputProof)).wait();
      const enc2 = await encryptForBank(2_000_000_000n, alice);
      await (await bank.connect(alice).deposit(enc2.handles[0], enc2.inputProof)).wait();
      const handle = await bank.connect(alice).getMyBalance();
      expect(await decryptU64(handle, bankAddress, alice)).to.equal(5_000_000_000n);
    });

    it("should revert deposit without account", async function () {
      const enc = await encryptForBank(1_000_000_000n, bob);
      await expect(bank.connect(bob).deposit(enc.handles[0], enc.inputProof))
        .to.be.revertedWith("Bank: no account");
    });
  });

  describe("Bank: Withdraw", function () {
    beforeEach(async function () {
      await (await bank.connect(alice).openAccount()).wait();
      const enc = await encryptForBank(10_000_000_000n, alice);
      await (await bank.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
    });

    it("should decrease balance after withdraw", async function () {
      const enc = await encryptForBank(3_000_000_000n, alice);
      await (await bank.connect(alice).withdraw(enc.handles[0], enc.inputProof)).wait();
      const handle = await bank.connect(alice).getMyBalance();
      expect(await decryptU64(handle, bankAddress, alice)).to.equal(7_000_000_000n);
    });

    it("should withdraw 0 when over-withdrawing (FHE privacy)", async function () {
      const enc = await encryptForBank(999_999_000_000n, alice);
      await (await bank.connect(alice).withdraw(enc.handles[0], enc.inputProof)).wait();
      const handle = await bank.connect(alice).getMyBalance();
      expect(await decryptU64(handle, bankAddress, alice)).to.equal(10_000_000_000n);
    });
  });

  describe("Bank: Transfer", function () {
    beforeEach(async function () {
      await (await bank.connect(alice).openAccount()).wait();
      await (await bank.connect(bob).openAccount()).wait();
      const enc = await encryptForBank(10_000_000_000n, alice);
      await (await bank.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
    });

    it("should transfer correctly", async function () {
      const enc = await encryptForBank(3_000_000_000n, alice);
      await (await bank.connect(alice).transfer(bob.address, enc.handles[0], enc.inputProof)).wait();
      const aliceH = await bank.connect(alice).getMyBalance();
      const bobH   = await bank.connect(bob).getMyBalance();
      expect(await decryptU64(aliceH, bankAddress, alice)).to.equal(7_000_000_000n);
      expect(await decryptU64(bobH,   bankAddress, bob)).to.equal(3_000_000_000n);
    });

    it("should revert self-transfer", async function () {
      const enc = await encryptForBank(1_000_000_000n, alice);
      await expect(bank.connect(alice).transfer(alice.address, enc.handles[0], enc.inputProof))
        .to.be.revertedWith("Bank: self-transfer");
    });

    it("should revert transfer to non-account", async function () {
      const stranger = ethers.Wallet.createRandom();
      const enc = await encryptForBank(1_000_000_000n, alice);
      await expect(bank.connect(alice).transfer(stranger.address, enc.handles[0], enc.inputProof))
        .to.be.revertedWith("Bank: recipient has no account");
    });

    it("should revert creditDeposit from non-lending", async function () {
      await expect(bank.connect(alice).creditDeposit(alice.address, ethers.ZeroHash))
        .to.be.revertedWith("Bank: caller is not lending");
    });
  });

  // ── SCORER ────────────────────────────────────────────────────────────────

  describe("Scorer: computeScore", function () {
    beforeEach(async () => { await (await bank.connect(alice).openAccount()).wait(); });

    it("should set timestamp", async function () {
      await (await scorer.connect(alice).computeScore(alice.address)).wait();
      expect(await scorer.getScoreTimestamp(alice.address)).to.be.gt(0n);
    });

    it("balance=0 → score=11 (not eligible)", async function () {
      await (await scorer.connect(alice).computeScore(alice.address)).wait();
      const result = await scorer.connect(alice).getMyScore.staticCall(alice.address);
      // result[0]=score, result[1]=eligible, result[2]=computedAt
      expect(await decryptU64(result[0], scorerAddress, alice)).to.equal(11n);
    });

    it("balance=25k USDC → score=58 → eligible", async function () {
      const enc = await encryptForBank(25_000_000_000n, alice);
      await (await bank.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
      await (await scorer.connect(alice).computeScore(alice.address)).wait();
      const result = await scorer.connect(alice).getMyScore.staticCall(alice.address);
      expect(await decryptU64(result[0], scorerAddress, alice)).to.equal(58n);
      expect(await decryptBool(result[1], scorerAddress, alice)).to.be.true;
    });

    it("should read balance directly from bank (not scorer)", async function () {
      const enc = await encryptForBank(5_000_000_000n, alice);
      await (await bank.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
      // Balance artık bank'tan direkt okunuyor
      const handle = await bank.connect(alice).getMyBalance();
      expect(await decryptU64(handle, bankAddress, alice)).to.equal(5_000_000_000n);
    });

    it("should revert compute for non-account", async function () {
      await expect(scorer.connect(alice).computeScore(bob.address))
        .to.be.revertedWith("Bank: no account");
    });

    it("should revert getMyScore unauthorized", async function () {
      await (await scorer.connect(alice).computeScore(alice.address)).wait();
      await expect(scorer.connect(bob).getMyScore(alice.address))
        .to.be.revertedWith("Scorer: unauthorized");
    });

    it("should revert getMyScore with no score", async function () {
      await expect(scorer.connect(alice).getMyScore(alice.address))
        .to.be.revertedWith("Scorer: no score computed");
    });
  });

  describe("Scorer: setScoringParameters", function () {
    it("should update all params including maxLoanAmount", async function () {
      await (await scorer.connect(owner).setScoringParameters(
        20_000_000_000n, 10_000_000_000n,
        100_000_000_000n, 40_000_000_000n,
        36n, 18n, 60n, 100_000_000_000n
      )).wait();
      expect(await scorer.maxLoanAmount()).to.equal(100_000_000_000n);
      expect(await scorer.eligibilityThreshold()).to.equal(60n);
      expect(await scorer.balanceThresholdHigh()).to.equal(20_000_000_000n);
    });

    it("should revert from non-owner", async function () {
      await expect(scorer.connect(bob).setScoringParameters(1n,1n,1n,1n,1n,1n,1n,1n))
        .to.be.reverted;
    });
  });

  // ── LENDING ───────────────────────────────────────────────────────────────

  describe("Lending: applyForLoan — eligible", function () {
    beforeEach(setupEligibleAlice);

    it("should apply and status = Active", async function () {
      const enc = await encryptForLending(5_000_000_000n, alice);
      await (await lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof)).wait();
      expect(await lending.getLoanStatus(alice.address)).to.equal(1);
    });

    it("should add loan to bank balance (creditDeposit)", async function () {
      const before = await decryptU64(await bank.connect(alice).getMyBalance(), bankAddress, alice);
      const enc = await encryptForLending(5_000_000_000n, alice);
      await (await lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof)).wait();
      const after = await decryptU64(await bank.connect(alice).getMyBalance(), bankAddress, alice);
      expect(after).to.equal(before + 5_000_000_000n);
    });

    it("should revert second loan while active", async function () {
      const enc = await encryptForLending(1_000_000_000n, alice);
      await (await lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof)).wait();
      const enc2 = await encryptForLending(500_000_000n, alice);
      await expect(lending.connect(alice).applyForLoan(enc2.handles[0], enc2.inputProof))
        .to.be.revertedWith("Lending: existing active loan");
    });
  });

  describe("Lending: max loan limit", function () {
    beforeEach(setupEligibleAlice);

    it("should approve 0 when exceeding maxLoanAmount", async function () {
      const enc = await encryptForLending(60_000_000_000n, alice);
      await (await lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof)).wait();
      const result = await lending.connect(alice).getMyLoan.staticCall(alice.address);
      expect(await decryptU64(result[0], lendingAddress, alice)).to.equal(0n);
    });
  });

  describe("Lending: ineligible", function () {
    it("should approve 0 when not eligible (low balance)", async function () {
      await (await bank.connect(alice).openAccount()).wait();
      const enc = await encryptForBank(100_000_000n, alice);
      await (await bank.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
      const loanEnc = await encryptForLending(1_000_000_000n, alice);
      await (await lending.connect(alice).applyForLoan(loanEnc.handles[0], loanEnc.inputProof)).wait();
      const result = await lending.connect(alice).getMyLoan.staticCall(alice.address);
      expect(await decryptU64(result[0], lendingAddress, alice)).to.equal(0n);
    });

    it("should deny loan after threshold raised above existing score", async function () {
      await setupEligibleAlice();

      await (await scorer.connect(owner).setScoringParameters(
        10_000_000_000n, 5_000_000_000n,
        50_000_000_000n, 20_000_000_000n,
        24n, 12n,
        70n,
        50_000_000_000n
      )).wait();

      const enc = await encryptForLending(1_000_000_000n, alice);
      await (await lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof)).wait();
      const result = await lending.connect(alice).getMyLoan.staticCall(alice.address);
      expect(await decryptU64(result[0], lendingAddress, alice)).to.equal(0n);
    });

    it("should deny loan after withdraw drops score below threshold", async function () {
      await (await bank.connect(alice).openAccount()).wait();

      const enc1 = await encryptForBank(25_000_000_000n, alice);
      await (await bank.connect(alice).deposit(enc1.handles[0], enc1.inputProof)).wait();

      const enc2 = await encryptForBank(25_000_000_000n, alice);
      await (await bank.connect(alice).withdraw(enc2.handles[0], enc2.inputProof)).wait();

      const enc3 = await encryptForLending(1_000_000_000n, alice);
      await (await lending.connect(alice).applyForLoan(enc3.handles[0], enc3.inputProof)).wait();
      const result = await lending.connect(alice).getMyLoan.staticCall(alice.address);
      expect(await decryptU64(result[0], lendingAddress, alice)).to.equal(0n);
    });
  });

  describe("Lending: repay", function () {
    const LOAN = 5_000_000_000n;
    beforeEach(async function () {
      await setupEligibleAlice();
      const enc = await encryptForLending(LOAN, alice);
      await (await lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof)).wait();
    });

    it("should set status Repaid", async function () {
      await (await lending.connect(alice).repay()).wait();
      expect(await lending.getLoanStatus(alice.address)).to.equal(2);
    });

    it("should deduct loan from bank balance (debitBalance)", async function () {
      const before = await decryptU64(await bank.connect(alice).getMyBalance(), bankAddress, alice);
      await (await lending.connect(alice).repay()).wait();
      const after = await decryptU64(await bank.connect(alice).getMyBalance(), bankAddress, alice);
      expect(after).to.equal(before - LOAN);
    });

    it("should allow new loan after repay", async function () {
      await (await lending.connect(alice).repay()).wait();
      const enc = await encryptForLending(2_000_000_000n, alice);
      await expect(lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof))
        .to.emit(lending, "LoanApplied");
    });

    it("should revert repay without active loan", async function () {
      await (await lending.connect(alice).repay()).wait();
      await expect(lending.connect(alice).repay())
        .to.be.revertedWith("Lending: no active loan");
    });
  });

  describe("Lending: getMyLoan", function () {
    beforeEach(async function () {
      await setupEligibleAlice();
      const enc = await encryptForLending(3_000_000_000n, alice);
      await (await lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof)).wait();
    });

    it("should return correct loan info", async function () {
      const result = await lending.connect(alice).getMyLoan.staticCall(alice.address);
      expect(result[1]).to.equal(1);
      expect(result[2]).to.be.gt(0n);
      expect(await decryptU64(result[0], lendingAddress, alice)).to.equal(3_000_000_000n);
    });

    it("should revert for unauthorized", async function () {
      await expect(lending.connect(bob).getMyLoan(alice.address))
        .to.be.revertedWith("Lending: unauthorized");
    });
  });

  describe("Lending: error cases", function () {
    it("should revert without bank account", async function () {
      const enc = await encryptForLending(1_000_000_000n, alice);
      await expect(lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof))
        .to.be.revertedWith("Lending: no bank account");
    });
  });

  // ── INTEGRATION ───────────────────────────────────────────────────────────

  describe("Integration: deposit → score → loan → repay → new loan", function () {
    it("full flow with balance verification", async function () {
      await (await bank.connect(alice).openAccount()).wait();

      const enc1 = await encryptForBank(25_000_000_000n, alice);
      await (await bank.connect(alice).deposit(enc1.handles[0], enc1.inputProof)).wait();

      await (await scorer.connect(alice).computeScore(alice.address)).wait();
      const scoreResult = await scorer.connect(alice).getMyScore.staticCall(alice.address);
      expect(await decryptBool(scoreResult[1], scorerAddress, alice)).to.be.true;

      const enc2 = await encryptForLending(10_000_000_000n, alice);
      await (await lending.connect(alice).applyForLoan(enc2.handles[0], enc2.inputProof)).wait();
      expect(await lending.getLoanStatus(alice.address)).to.equal(1);

      const balWithLoan = await decryptU64(await bank.connect(alice).getMyBalance(), bankAddress, alice);
      expect(balWithLoan).to.equal(35_000_000_000n);

      await (await lending.connect(alice).repay()).wait();
      expect(await lending.getLoanStatus(alice.address)).to.equal(2);

      const balAfterRepay = await decryptU64(await bank.connect(alice).getMyBalance(), bankAddress, alice);
      expect(balAfterRepay).to.equal(25_000_000_000n);

      const enc3 = await encryptForLending(5_000_000_000n, alice);
      await (await lending.connect(alice).applyForLoan(enc3.handles[0], enc3.inputProof)).wait();
      expect(await lending.getLoanStatus(alice.address)).to.equal(1);
    });
  });
});
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Confidential Bank & Credit Scoring", function () {

  let bank: any;
  let scorer: any;
  let lending: any;
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let bankAddress: string;
  let scorerAddress: string;
  let lendingAddress: string;

  async function encryptAmount(value: number, contractAddress: string, signer: HardhatEthersSigner) {
    return fhevm.createEncryptedInput(contractAddress, signer.address).add64(value).encrypt();
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
    await (await scorer.setLendingContract(lendingAddress)).wait();
  });

  describe("ConfidentialBank", function () {

    describe("Account Management", function () {
      it("should open an account", async function () {
        await (await bank.connect(alice).openAccount()).wait();
        expect(await bank.hasAccount(alice.address)).to.be.true;
      });

      it("should revert on duplicate account", async function () {
        await (await bank.connect(alice).openAccount()).wait();
        await expect(bank.connect(alice).openAccount()).to.be.revertedWith("Bank: account already exists");
      });

      it("should initialise balance to zero", async function () {
        await (await bank.connect(alice).openAccount()).wait();
        const handle = await bank.connect(alice).getMyBalance();
        expect(await decryptU64(handle, bankAddress, alice)).to.equal(0n);
      });
    });

    describe("Deposit", function () {
      beforeEach(async function () {
        await (await bank.connect(alice).openAccount()).wait();
      });

      it("should increase balance after deposit", async function () {
        const enc = await encryptAmount(5_000_000_000, bankAddress, alice);
        await (await bank.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
        const handle = await bank.connect(alice).getMyBalance();
        expect(await decryptU64(handle, bankAddress, alice)).to.equal(5_000_000_000n);
      });

      it("should accumulate multiple deposits", async function () {
        const enc1 = await encryptAmount(3_000_000_000, bankAddress, alice);
        const enc2 = await encryptAmount(2_000_000_000, bankAddress, alice);
        await (await bank.connect(alice).deposit(enc1.handles[0], enc1.inputProof)).wait();
        await (await bank.connect(alice).deposit(enc2.handles[0], enc2.inputProof)).wait();
        const handle = await bank.connect(alice).getMyBalance();
        expect(await decryptU64(handle, bankAddress, alice)).to.equal(5_000_000_000n);
      });

      it("should revert if caller has no account", async function () {
        const enc = await encryptAmount(100, bankAddress, bob);
        await expect(bank.connect(bob).deposit(enc.handles[0], enc.inputProof)).to.be.revertedWith("Bank: no account");
      });
    });

    describe("Withdraw", function () {
      beforeEach(async function () {
        await (await bank.connect(alice).openAccount()).wait();
        const enc = await encryptAmount(10_000_000_000, bankAddress, alice);
        await (await bank.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
      });

      it("should decrease balance", async function () {
        const enc = await encryptAmount(3_000_000_000, bankAddress, alice);
        await (await bank.connect(alice).withdraw(enc.handles[0], enc.inputProof)).wait();
        const handle = await bank.connect(alice).getMyBalance();
        expect(await decryptU64(handle, bankAddress, alice)).to.equal(7_000_000_000n);
      });

      it("should withdraw 0 when amount exceeds balance (oblivious conditional)", async function () {
        const enc = await encryptAmount(99_000_000_000, bankAddress, alice);
        await (await bank.connect(alice).withdraw(enc.handles[0], enc.inputProof)).wait();
        const handle = await bank.connect(alice).getMyBalance();
        expect(await decryptU64(handle, bankAddress, alice)).to.equal(10_000_000_000n);
      });
    });

    describe("Transfer", function () {
      beforeEach(async function () {
        await (await bank.connect(alice).openAccount()).wait();
        await (await bank.connect(bob).openAccount()).wait();
        const enc = await encryptAmount(8_000_000_000, bankAddress, alice);
        await (await bank.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
      });

      it("should move funds between accounts", async function () {
        const enc = await encryptAmount(3_000_000_000, bankAddress, alice);
        await (await bank.connect(alice).transfer(bob.address, enc.handles[0], enc.inputProof)).wait();
        const aliceHandle = await bank.connect(alice).getMyBalance();
        const bobHandle   = await bank.connect(bob).getMyBalance();
        expect(await decryptU64(aliceHandle, bankAddress, alice)).to.equal(5_000_000_000n);
        expect(await decryptU64(bobHandle,   bankAddress, bob)).to.equal(3_000_000_000n);
      });

      it("should not change balances when amount exceeds balance", async function () {
        const enc = await encryptAmount(50_000_000_000, bankAddress, alice);
        await (await bank.connect(alice).transfer(bob.address, enc.handles[0], enc.inputProof)).wait();
        const aliceHandle = await bank.connect(alice).getMyBalance();
        expect(await decryptU64(aliceHandle, bankAddress, alice)).to.equal(8_000_000_000n);
      });

      it("should revert on self-transfer", async function () {
        const enc = await encryptAmount(100_000_000, bankAddress, alice);
        await expect(bank.connect(alice).transfer(alice.address, enc.handles[0], enc.inputProof))
          .to.be.revertedWith("Bank: self-transfer not allowed");
      });

      it("should revert if recipient has no account", async function () {
        const enc = await encryptAmount(100_000_000, bankAddress, alice);
        await expect(bank.connect(alice).transfer(owner.address, enc.handles[0], enc.inputProof))
          .to.be.revertedWith("Bank: recipient has no account");
      });
    });
  });

  describe("ConfidentialCreditScorer", function () {

    beforeEach(async function () {
      await (await bank.connect(alice).openAccount()).wait();
    });

    it("should return 0 timestamp before score is computed", async function () {
      expect(await scorer.getScoreTimestamp(alice.address)).to.equal(0n);
    });

    it("should record timestamp after computeScore", async function () {
      await (await scorer.computeScore(alice.address)).wait();
      expect(await scorer.getScoreTimestamp(alice.address)).to.be.gt(0n);
    });

    it("should give minimum score with no deposits or tenure", async function () {
      await (await scorer.computeScore(alice.address)).wait();
      const { score, eligible } = await scorer.connect(alice).getMyScore(alice.address);
      expect(await decryptU64(score, scorerAddress, alice)).to.equal(11n); // 5+3+3
      expect(await decryptBool(eligible, scorerAddress, alice)).to.equal(false);
    });

    it("should give maximum score with strong financials", async function () {
      const enc = await encryptAmount(55_000_000_000, bankAddress, alice);
      await (await bank.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
      for (let i = 0; i < 25; i++) {
        await (await bank.connect(owner).incrementMonthsActive(alice.address)).wait();
      }
      await (await scorer.computeScore(alice.address)).wait();
      const { score, eligible } = await scorer.connect(alice).getMyScore(alice.address);
      expect(await decryptU64(score, scorerAddress, alice)).to.equal(100n);
      expect(await decryptBool(eligible, scorerAddress, alice)).to.equal(true);
    });

    it("should reject unauthorized queries", async function () {
      await (await scorer.computeScore(alice.address)).wait();
      await expect(scorer.connect(bob).getMyScore(alice.address)).to.be.revertedWith("Scorer: unauthorized");
    });
  });

  describe("ConfidentialLending", function () {

    async function setupEligible(signer: HardhatEthersSigner) {
      await (await bank.connect(signer).openAccount()).wait();
      const enc = await encryptAmount(55_000_000_000, bankAddress, signer);
      await (await bank.connect(signer).deposit(enc.handles[0], enc.inputProof)).wait();
      for (let i = 0; i < 25; i++) {
        await (await bank.connect(owner).incrementMonthsActive(signer.address)).wait();
      }
      await (await scorer.computeScore(signer.address)).wait();
    }

    async function setupIneligible(signer: HardhatEthersSigner) {
      await (await bank.connect(signer).openAccount()).wait();
      await (await scorer.computeScore(signer.address)).wait();
    }

    it("should create active loan for eligible customer", async function () {
      await setupEligible(alice);
      const enc = await encryptAmount(5_000_000_000, lendingAddress, alice);
      await (await lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof)).wait();
      expect(await lending.getLoanStatus(alice.address)).to.equal(1);
    });

    it("should approve 0 for ineligible customer", async function () {
      await setupIneligible(alice);
      const enc = await encryptAmount(5_000_000_000, lendingAddress, alice);
      await (await lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof)).wait();
      const { amount } = await lending.connect(alice).getMyLoan(alice.address);
      expect(await decryptU64(amount, lendingAddress, alice)).to.equal(0n);
    });

    it("should revert if customer has no bank account", async function () {
      const enc = await encryptAmount(1_000_000_000, lendingAddress, alice);
      await expect(lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof))
        .to.be.revertedWith("Lending: no bank account");
    });

    it("should revert if no score computed", async function () {
      await (await bank.connect(alice).openAccount()).wait();
      const enc = await encryptAmount(1_000_000_000, lendingAddress, alice);
      await expect(lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof))
        .to.be.revertedWith("Scorer: no score computed yet");
    });

    it("should revert on duplicate active loan", async function () {
      await setupEligible(alice);
      const enc1 = await encryptAmount(1_000_000_000, lendingAddress, alice);
      await (await lending.connect(alice).applyForLoan(enc1.handles[0], enc1.inputProof)).wait();
      const enc2 = await encryptAmount(1_000_000_000, lendingAddress, alice);
      await expect(lending.connect(alice).applyForLoan(enc2.handles[0], enc2.inputProof))
        .to.be.revertedWith("Lending: existing active loan");
    });

    it("should accumulate repayments", async function () {
      await setupEligible(alice);
      const loan = await encryptAmount(5_000_000_000, lendingAddress, alice);
      await (await lending.connect(alice).applyForLoan(loan.handles[0], loan.inputProof)).wait();

      const rep1 = await encryptAmount(1_000_000_000, lendingAddress, alice);
      const rep2 = await encryptAmount(2_000_000_000, lendingAddress, alice);
      await (await lending.connect(alice).repay(rep1.handles[0], rep1.inputProof)).wait();
      await (await lending.connect(alice).repay(rep2.handles[0], rep2.inputProof)).wait();

      const { repaidAmount } = await lending.connect(alice).getMyLoan(alice.address);
      expect(await decryptU64(repaidAmount, lendingAddress, alice)).to.equal(3_000_000_000n);
    });

    it("should allow owner to mark loan as repaid", async function () {
      await setupEligible(alice);
      const enc = await encryptAmount(1_000_000_000, lendingAddress, alice);
      await (await lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof)).wait();
      await (await lending.connect(owner).markAsRepaid(alice.address)).wait();
      expect(await lending.getLoanStatus(alice.address)).to.equal(2);
    });

    it("should reject unauthorized loan queries", async function () {
      await setupEligible(alice);
      const enc = await encryptAmount(1_000_000_000, lendingAddress, alice);
      await (await lending.connect(alice).applyForLoan(enc.handles[0], enc.inputProof)).wait();
      await expect(lending.connect(bob).getMyLoan(alice.address))
        .to.be.revertedWith("Lending: unauthorized");
    });

    it("should only allow owner to read total loan volume", async function () {
      await expect(lending.connect(alice).getTotalLoanVolume()).to.be.reverted;
    });
  });
  describe("Scoring Parameters", function () {
  it("should have correct default parameters", async function () {
    expect(await scorer.balanceThresholdHigh()).to.equal(10_000_000_000n);
    expect(await scorer.balanceThresholdMed()).to.equal(5_000_000_000n);
    expect(await scorer.eligibilityThreshold()).to.equal(50n);
  });

  it("should allow owner to update scoring parameters", async function () {
    await (await scorer.connect(owner).setScoringParameters(
      20_000_000_000n, // balanceHigh
      8_000_000_000n,  // balanceMed
      60_000_000_000n, // depositHigh
      25_000_000_000n, // depositMed
      36,              // monthsHigh
      18,              // monthsMed
      70               // eligibility (sıkılaştırma)
    )).wait();

    expect(await scorer.balanceThresholdHigh()).to.equal(20_000_000_000n);
    expect(await scorer.eligibilityThreshold()).to.equal(70n);
  });

  it("should reject non-owner parameter update", async function () {
    await expect(scorer.connect(alice).setScoringParameters(
      20_000_000_000n,
      8_000_000_000n,
      60_000_000_000n,
      25_000_000_000n,
      36, 18, 70
    )).to.be.reverted;
  });

  it("should revert when balanceMed >= balanceHigh", async function () {
    await expect(scorer.connect(owner).setScoringParameters(
      5_000_000_000n,  // high
      5_000_000_000n,  // med == high → geçersiz
      60_000_000_000n,
      25_000_000_000n,
      36, 18, 70
    )).to.be.revertedWith("Scorer: invalid balance thresholds");
  });

  it("should revert when eligibility > 100", async function () {
    await expect(scorer.connect(owner).setScoringParameters(
      20_000_000_000n,
      8_000_000_000n,
      60_000_000_000n,
      25_000_000_000n,
      36, 18, 101
    )).to.be.revertedWith("Scorer: eligibility max 100");
  });

  it("higher eligibility threshold should make previously eligible user ineligible", async function () {
    // Alice güçlü finansallarla eligible oluyor
    await (await bank.connect(alice).openAccount()).wait();
    const enc = await encryptAmount(55_000_000_000, bankAddress, alice);
    await (await bank.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
    for (let i = 0; i < 25; i++) {
      await (await bank.connect(owner).incrementMonthsActive(alice.address)).wait();
    }
    await (await scorer.computeScore(alice.address)).wait();
    const { eligible: before } = await scorer.connect(alice).getMyScore(alice.address);
    expect(await decryptBool(before, scorerAddress, alice)).to.equal(true);

    // Eşiği 95'e çıkar — artık kimse geçemez
    await (await scorer.connect(owner).setScoringParameters(
      20_000_000_000n,
      8_000_000_000n,
      60_000_000_000n,
      25_000_000_000n,
      36, 18, 95
    )).wait();

    // Skoru yeniden hesapla
    await (await scorer.computeScore(alice.address)).wait();
    const { eligible: after } = await scorer.connect(alice).getMyScore(alice.address);
    expect(await decryptBool(after, scorerAddress, alice)).to.equal(false);
  });
});
});

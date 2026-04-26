import { expect } from "chai";
import { ethers } from "hardhat";
import { ZeroAddress } from "ethers";
import type { Signer } from "ethers";

const ZEBVIX_CHAIN_ID = 7878n;

async function deployFixture(opts?: {
  numValidators?: number;
  threshold?: number;
}) {
  const numValidators = opts?.numValidators ?? 5;
  const threshold = opts?.threshold ?? 3;

  const signers = await ethers.getSigners();
  const owner = signers[0];
  const user = signers[1];
  const validatorSigners: Signer[] = signers.slice(2, 2 + numValidators);
  const validatorAddresses = await Promise.all(
    validatorSigners.map((s) => s.getAddress()),
  );

  // 1) Deploy wZBX with placeholder admin (owner) and no minter yet.
  const WrappedZBX = await ethers.getContractFactory("WrappedZBX");
  const wzbx = await WrappedZBX.deploy(await owner.getAddress(), ZeroAddress);
  await wzbx.waitForDeployment();

  // 2) Deploy bridge.
  const Bridge = await ethers.getContractFactory("ZebvixBridge");
  const bridge = await Bridge.deploy(
    await owner.getAddress(),
    await wzbx.getAddress(),
    validatorAddresses,
    threshold,
    ZEBVIX_CHAIN_ID,
  );
  await bridge.waitForDeployment();

  // 3) Grant MINTER_ROLE on wZBX to bridge.
  const MINTER_ROLE = await wzbx.MINTER_ROLE();
  await wzbx.connect(owner).grantRole(MINTER_ROLE, await bridge.getAddress());

  return { owner, user, validatorSigners, validatorAddresses, wzbx, bridge, threshold };
}

interface MintReq {
  sourceTxHash: string;
  recipient: string;
  amount: bigint;
  sourceChainId: bigint;
  sourceBlockHeight: bigint;
}

async function signMint(
  bridgeAddress: string,
  req: MintReq,
  signer: Signer,
): Promise<string> {
  const network = await ethers.provider.getNetwork();
  const domain = {
    name: "ZebvixBridge",
    version: "1",
    chainId: network.chainId,
    verifyingContract: bridgeAddress,
  };
  const types = {
    MintRequest: [
      { name: "sourceTxHash", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "sourceChainId", type: "uint256" },
      { name: "sourceBlockHeight", type: "uint64" },
    ],
  };
  return await (signer as any).signTypedData(domain, types, req);
}

function makeReq(over: Partial<MintReq> = {}): MintReq {
  return {
    sourceTxHash:
      over.sourceTxHash ??
      "0x" + "ab".repeat(32),
    recipient: over.recipient ?? "0x000000000000000000000000000000000000dEaD",
    amount: over.amount ?? ethers.parseEther("5"),
    sourceChainId: over.sourceChainId ?? ZEBVIX_CHAIN_ID,
    sourceBlockHeight: over.sourceBlockHeight ?? 100n,
  };
}

describe("ZebvixBridge", () => {
  describe("deployment", () => {
    it("rejects threshold > validators", async () => {
      const Bridge = await ethers.getContractFactory("ZebvixBridge");
      const [a] = await ethers.getSigners();
      const wAddr = await a.getAddress();
      await expect(
        Bridge.deploy(wAddr, wAddr, [wAddr], 2, ZEBVIX_CHAIN_ID),
      ).to.be.revertedWith("Bridge: validators < threshold");
    });

    it("rejects duplicate validators", async () => {
      const Bridge = await ethers.getContractFactory("ZebvixBridge");
      const [a, b] = await ethers.getSigners();
      const wAddr = await a.getAddress();
      const bAddr = await b.getAddress();
      await expect(
        Bridge.deploy(wAddr, wAddr, [bAddr, bAddr], 1, ZEBVIX_CHAIN_ID),
      ).to.be.revertedWith("Bridge: duplicate validator");
    });

    it("emits ValidatorAdded for each validator", async () => {
      const f = await deployFixture({ numValidators: 3, threshold: 2 });
      expect(await f.bridge.validatorCount()).to.equal(3);
      expect(await f.bridge.threshold()).to.equal(2);
      for (const v of f.validatorAddresses) {
        expect(await f.bridge.isValidator(v)).to.equal(true);
      }
    });
  });

  describe("mintFromZebvix", () => {
    it("mints with exactly threshold valid signatures", async () => {
      const f = await deployFixture({ numValidators: 5, threshold: 3 });
      const req = makeReq({ recipient: await f.user.getAddress() });
      const bridgeAddr = await f.bridge.getAddress();

      const sigs = await Promise.all(
        f.validatorSigners.slice(0, 3).map((s) => signMint(bridgeAddr, req, s)),
      );

      await expect(f.bridge.mintFromZebvix(req, sigs))
        .to.emit(f.bridge, "MintFromZebvix")
        .withArgs(req.sourceTxHash, req.recipient, req.amount, req.sourceBlockHeight, 3);

      expect(await f.wzbx.balanceOf(await f.user.getAddress())).to.equal(req.amount);
    });

    it("mints with more than threshold sigs", async () => {
      const f = await deployFixture({ numValidators: 5, threshold: 3 });
      const req = makeReq({ recipient: await f.user.getAddress() });
      const bridgeAddr = await f.bridge.getAddress();
      const sigs = await Promise.all(
        f.validatorSigners.slice(0, 5).map((s) => signMint(bridgeAddr, req, s)),
      );
      await expect(f.bridge.mintFromZebvix(req, sigs)).to.emit(f.bridge, "MintFromZebvix");
    });

    it("rejects insufficient signatures", async () => {
      const f = await deployFixture({ numValidators: 5, threshold: 3 });
      const req = makeReq({ recipient: await f.user.getAddress() });
      const bridgeAddr = await f.bridge.getAddress();
      const sigs = await Promise.all(
        f.validatorSigners.slice(0, 2).map((s) => signMint(bridgeAddr, req, s)),
      );
      await expect(f.bridge.mintFromZebvix(req, sigs)).to.be.revertedWith(
        "Bridge: insufficient sigs",
      );
    });

    it("rejects duplicate signer (same validator signs twice)", async () => {
      const f = await deployFixture({ numValidators: 5, threshold: 3 });
      const req = makeReq({ recipient: await f.user.getAddress() });
      const bridgeAddr = await f.bridge.getAddress();
      const sig0 = await signMint(bridgeAddr, req, f.validatorSigners[0]);
      const sig1 = await signMint(bridgeAddr, req, f.validatorSigners[1]);
      await expect(
        f.bridge.mintFromZebvix(req, [sig0, sig0, sig1]),
      ).to.be.revertedWith("Bridge: duplicate signer");
    });

    it("rejects signature from non-validator", async () => {
      const f = await deployFixture({ numValidators: 5, threshold: 3 });
      const req = makeReq({ recipient: await f.user.getAddress() });
      const bridgeAddr = await f.bridge.getAddress();
      const goodSigs = await Promise.all(
        f.validatorSigners.slice(0, 2).map((s) => signMint(bridgeAddr, req, s)),
      );
      const badSig = await signMint(bridgeAddr, req, f.user); // user is not a validator
      await expect(
        f.bridge.mintFromZebvix(req, [...goodSigs, badSig]),
      ).to.be.revertedWith("Bridge: not a validator");
    });

    it("rejects replay (consumed source tx hash)", async () => {
      const f = await deployFixture({ numValidators: 5, threshold: 3 });
      const req = makeReq({ recipient: await f.user.getAddress() });
      const bridgeAddr = await f.bridge.getAddress();
      const sigs = await Promise.all(
        f.validatorSigners.slice(0, 3).map((s) => signMint(bridgeAddr, req, s)),
      );
      await f.bridge.mintFromZebvix(req, sigs);
      await expect(f.bridge.mintFromZebvix(req, sigs)).to.be.revertedWith(
        "Bridge: already consumed",
      );
    });

    it("rejects when paused", async () => {
      const f = await deployFixture({ numValidators: 5, threshold: 3 });
      await f.bridge.connect(f.owner).pause();
      const req = makeReq({ recipient: await f.user.getAddress() });
      const bridgeAddr = await f.bridge.getAddress();
      const sigs = await Promise.all(
        f.validatorSigners.slice(0, 3).map((s) => signMint(bridgeAddr, req, s)),
      );
      await expect(f.bridge.mintFromZebvix(req, sigs)).to.be.revertedWithCustomError(
        f.bridge,
        "EnforcedPause",
      );
    });

    it("rejects mint with wrong source chain id", async () => {
      const f = await deployFixture({ numValidators: 5, threshold: 3 });
      const req = makeReq({
        recipient: await f.user.getAddress(),
        sourceChainId: 1n, // wrong
      });
      const bridgeAddr = await f.bridge.getAddress();
      const sigs = await Promise.all(
        f.validatorSigners.slice(0, 3).map((s) => signMint(bridgeAddr, req, s)),
      );
      await expect(f.bridge.mintFromZebvix(req, sigs)).to.be.revertedWith(
        "Bridge: bad source chain",
      );
    });
  });

  describe("burnToZebvix", () => {
    it("burns wZBX and emits BurnToZebvix with seq", async () => {
      const f = await deployFixture();
      const userAddr = await f.user.getAddress();
      const bridgeAddr = await f.bridge.getAddress();

      // First mint some wZBX to user
      const req = makeReq({ recipient: userAddr, amount: ethers.parseEther("10") });
      const sigs = await Promise.all(
        f.validatorSigners.slice(0, 3).map((s) => signMint(bridgeAddr, req, s)),
      );
      await f.bridge.mintFromZebvix(req, sigs);

      // Approve and burn
      const burnAmount = ethers.parseEther("4");
      await f.wzbx.connect(f.user).approve(bridgeAddr, burnAmount);
      const zebAddr = "0x" + "12".repeat(20);

      await expect(f.bridge.connect(f.user).burnToZebvix(zebAddr, burnAmount))
        .to.emit(f.bridge, "BurnToZebvix");

      expect(await f.wzbx.balanceOf(userAddr)).to.equal(ethers.parseEther("6"));
      expect(await f.bridge.burnSeq()).to.equal(1n);
    });

    it("rejects malformed zebvix address", async () => {
      const f = await deployFixture();
      await expect(
        f.bridge.connect(f.user).burnToZebvix("not-a-valid-addr", 1n),
      ).to.be.revertedWith("Bridge: bad zebvix addr");
    });
  });

  describe("governance", () => {
    it("owner can add validator", async () => {
      const f = await deployFixture({ numValidators: 3, threshold: 2 });
      const newV = ethers.Wallet.createRandom().address;
      await expect(f.bridge.connect(f.owner).addValidator(newV))
        .to.emit(f.bridge, "ValidatorAdded").withArgs(newV);
      expect(await f.bridge.validatorCount()).to.equal(4);
    });

    it("owner can remove validator (if threshold still satisfiable)", async () => {
      const f = await deployFixture({ numValidators: 3, threshold: 2 });
      await expect(
        f.bridge.connect(f.owner).removeValidator(f.validatorAddresses[0]),
      ).to.emit(f.bridge, "ValidatorRemoved");
    });

    it("rejects removing validator that breaks threshold", async () => {
      const f = await deployFixture({ numValidators: 2, threshold: 2 });
      await expect(
        f.bridge.connect(f.owner).removeValidator(f.validatorAddresses[0]),
      ).to.be.revertedWith("Bridge: would break threshold");
    });

    it("owner can change threshold", async () => {
      const f = await deployFixture({ numValidators: 5, threshold: 3 });
      await expect(f.bridge.connect(f.owner).setThreshold(4))
        .to.emit(f.bridge, "ThresholdChanged").withArgs(3, 4);
    });

    it("non-owner cannot add validator", async () => {
      const f = await deployFixture();
      await expect(
        f.bridge.connect(f.user).addValidator(await f.user.getAddress()),
      ).to.be.revertedWithCustomError(f.bridge, "OwnableUnauthorizedAccount");
    });
  });
});

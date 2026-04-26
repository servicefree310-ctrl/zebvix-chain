import { expect } from "chai";
import { ethers } from "hardhat";

describe("WrappedZBX", () => {
  it("has 18 decimals", async () => {
    const [admin] = await ethers.getSigners();
    const W = await ethers.getContractFactory("WrappedZBX");
    const w = await W.deploy(await admin.getAddress(), await admin.getAddress());
    await w.waitForDeployment();
    expect(await w.decimals()).to.equal(18);
    expect(await w.symbol()).to.equal("wZBX");
    expect(await w.name()).to.equal("Wrapped ZBX");
  });

  it("only minter can mint", async () => {
    const [admin, attacker, recipient] = await ethers.getSigners();
    const W = await ethers.getContractFactory("WrappedZBX");
    const w = await W.deploy(await admin.getAddress(), await admin.getAddress());
    await w.waitForDeployment();
    // admin IS the minter in this test, so admin can mint
    await w.connect(admin).mint(await recipient.getAddress(), 100n);
    expect(await w.balanceOf(await recipient.getAddress())).to.equal(100n);
    // attacker cannot
    await expect(
      w.connect(attacker).mint(await recipient.getAddress(), 100n),
    ).to.be.revertedWithCustomError(w, "AccessControlUnauthorizedAccount");
  });

  it("admin can grant/revoke minter", async () => {
    const [admin, newMinter] = await ethers.getSigners();
    const W = await ethers.getContractFactory("WrappedZBX");
    const w = await W.deploy(await admin.getAddress(), ethers.ZeroAddress);
    await w.waitForDeployment();
    const MINTER = await w.MINTER_ROLE();
    expect(await w.hasRole(MINTER, await newMinter.getAddress())).to.equal(false);
    await w.connect(admin).grantMinter(await newMinter.getAddress());
    expect(await w.hasRole(MINTER, await newMinter.getAddress())).to.equal(true);
    await w.connect(admin).revokeMinter(await newMinter.getAddress());
    expect(await w.hasRole(MINTER, await newMinter.getAddress())).to.equal(false);
  });

  it("pausable blocks transfers", async () => {
    const [admin, user] = await ethers.getSigners();
    const W = await ethers.getContractFactory("WrappedZBX");
    const w = await W.deploy(await admin.getAddress(), await admin.getAddress());
    await w.waitForDeployment();
    await w.connect(admin).mint(await user.getAddress(), 100n);
    await w.connect(admin).pause();
    await expect(
      w.connect(user).transfer(await admin.getAddress(), 10n),
    ).to.be.revertedWithCustomError(w, "EnforcedPause");
  });
});

import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import type { HardhatUserConfig } from "hardhat/config";

const ADMIN_PRIVATE_KEY = process.env.BSC_DEPLOYER_PRIVATE_KEY ?? "";
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY ?? "";

const accounts =
  ADMIN_PRIVATE_KEY && /^(0x)?[0-9a-fA-F]{64}$/.test(ADMIN_PRIVATE_KEY)
    ? [ADMIN_PRIVATE_KEY.startsWith("0x") ? ADMIN_PRIVATE_KEY : "0x" + ADMIN_PRIVATE_KEY]
    : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: false,
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC ?? "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts,
      gasPrice: 10_000_000_000, // 10 gwei
    },
    bsc: {
      url: process.env.BSC_MAINNET_RPC ?? "https://bsc-dataseed.binance.org",
      chainId: 56,
      accounts,
      gasPrice: 3_000_000_000, // 3 gwei (BSC base)
    },
  },
  etherscan: {
    apiKey: {
      bscTestnet: BSCSCAN_API_KEY,
      bsc: BSCSCAN_API_KEY,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    token: "BNB",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 60_000,
  },
};

export default config;

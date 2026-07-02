/**
 * Network definitions and viem client construction.
 *
 * Batch payouts are signed and sent LOCALLY (non-custodial) — never through a
 * gateway. RPC endpoints default to viem's built-in public RPC for each chain and
 * can be overridden per-network via env vars.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import type { SpraayNetwork } from "./config.js";
import type { WalletInfo } from "./wallet.js";

export interface NetworkInfo {
  chain: typeof base | typeof baseSepolia;
  /** USDC token contract. */
  usdc: `0x${string}`;
  /** Spray batch-payout contract. `null` until a deployment address is known. */
  sprayContract: `0x${string}` | null;
  explorer: string;
  /** Env var that overrides the RPC URL for this network. */
  rpcEnv: string;
}

export const NETWORKS: Record<SpraayNetwork, NetworkInfo> = {
  base: {
    chain: base,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    sprayContract: "0x1646452F98E36A3c9Cfc3eDD8868221E207B5eEC",
    explorer: "https://basescan.org",
    rpcEnv: "SPRAAY_BASE_RPC_URL",
  },
  "base-sepolia": {
    chain: baseSepolia,
    // Circle's official Base Sepolia USDC.
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    // SprayContract deployed by SpraayPay with 0 fee bps (feeRecipient = session wallet).
    sprayContract: "0xfb1B884E489B0296CefadA2d8Db7CFbD1ED62f7A",
    explorer: "https://sepolia.basescan.org",
    rpcEnv: "SPRAAY_BASE_SEPOLIA_RPC_URL",
  },
};

export function networkInfo(network: SpraayNetwork): NetworkInfo {
  return NETWORKS[network];
}

/** Resolve the RPC URL for a network (env override → chain default). */
function rpcUrl(net: NetworkInfo): string | undefined {
  return process.env[net.rpcEnv]?.trim() || undefined;
}

// Base is an OP-stack chain, so its fully-parameterized client type isn't directly
// assignable to viem's base `PublicClient`/`WalletClient` (block/transaction unions
// differ). We widen to the base types — runtime behavior is identical.
export function getPublicClient(network: SpraayNetwork): PublicClient {
  const net = NETWORKS[network];
  return createPublicClient({ chain: net.chain, transport: http(rpcUrl(net)) }) as unknown as PublicClient;
}

export function getWalletClient(network: SpraayNetwork, wallet: WalletInfo): WalletClient {
  const net = NETWORKS[network];
  const account = privateKeyToAccount(wallet.privateKey);
  return createWalletClient({
    account,
    chain: net.chain,
    transport: http(rpcUrl(net)),
  }) as unknown as WalletClient;
}

/** Explorer link for a tx hash on the given network. */
export function txUrl(network: SpraayNetwork, hash: string): string {
  return `${NETWORKS[network].explorer}/tx/${hash}`;
}

/** Explorer link for an address on the given network. */
export function addressUrl(network: SpraayNetwork, address: string): string {
  return `${NETWORKS[network].explorer}/address/${address}`;
}

/** Require a deployed Spray contract, with a clear error when absent (e.g. Sepolia). */
export function requireSprayContract(network: SpraayNetwork): `0x${string}` {
  const addr = NETWORKS[network].sprayContract;
  if (!addr) {
    throw new Error(
      `No Spray batch-payout contract is configured for network "${network}". ` +
        `Set its address in src/chains.ts before running batch payouts there.`,
    );
  }
  return addr;
}

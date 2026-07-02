/**
 * Gasless payouts via the Coinbase CDP Paymaster (ERC-4337).
 *
 * mangoswap (see ./reference/mangoswap) does this in the browser with EIP-5792
 * `wallet_sendCalls` + a `paymasterService` capability pointed at the CDP endpoint
 * (https://api.developer.coinbase.com/rpc/v1/base/<KEY>). SpraayPay is headless with
 * a raw key, so the equivalent is ERC-4337: a Coinbase Smart Account owned by our EOA
 * sends a batched UserOperation through the same CDP Paymaster & Bundler URL, sponsored.
 *
 * Consequence: when gasless is active the FUNDED address (which holds USDC and is
 * msg.sender for the spray) is the SMART ACCOUNT, not the EOA. The EOA only signs.
 *
 * Gasless is OPT-IN: it activates only when a paymaster URL is configured AND
 * sponsorship is enabled. Otherwise SpraayPay uses the Phase 2 EOA path.
 *
 * Sponsorship capping: the primary control is a CDP dashboard policy on the paymaster
 * key (per-user / per-period limits). `sponsorship.capUsd` is the local hook for future
 * client-side enforcement — see evaluateSponsorship().
 */

import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createBundlerClient,
  toCoinbaseSmartAccount,
  type SmartAccount,
} from "viem/account-abstraction";
import { getPublicClient } from "./chains.js";
import type { SpraayConfig, SpraayNetwork } from "./config.js";
import type { WalletInfo } from "./wallet.js";

/** Resolve the CDP paymaster URL: env override → config. */
export function paymasterUrl(config: SpraayConfig): string | undefined {
  return (
    process.env.CDP_PAYMASTER_URL?.trim() ||
    process.env.SPRAAY_PAYMASTER_URL?.trim() ||
    config.paymasterUrl
  );
}

/** Is gasless (sponsored) mode active? Requires a paymaster URL and sponsorship on. */
export function gaslessActive(config: SpraayConfig): boolean {
  return config.sponsorship.enabled && !!paymasterUrl(config);
}

export interface SponsorshipDecision {
  sponsor: boolean;
  reason?: string;
}

/**
 * Decide whether to sponsor this payout. Today: sponsor whenever gasless is active.
 * The `capUsd` hook is where local per-period metering would gate sponsorship later
 * (server-side CDP policy remains the authoritative cap); wired here so callers don't
 * change when enforcement lands.
 */
export function evaluateSponsorship(config: SpraayConfig): SponsorshipDecision {
  if (!config.sponsorship.enabled) return { sponsor: false, reason: "Sponsorship disabled." };
  if (!paymasterUrl(config)) return { sponsor: false, reason: "No paymaster URL configured." };
  // TODO(cap): when capUsd enforcement is added, meter sponsored gas here and return
  // { sponsor: false, reason: "Sponsorship cap reached" } past the limit.
  return { sponsor: true };
}

/** The Coinbase Smart Account owned by our EOA. Its address is the gasless funding target. */
export async function getSmartAccount(
  network: SpraayNetwork,
  wallet: WalletInfo,
): Promise<SmartAccount> {
  const client = getPublicClient(network);
  const owner = privateKeyToAccount(wallet.privateKey);
  return toCoinbaseSmartAccount({ client, owners: [owner], version: "1.1" });
}

/** Deterministic smart-account address (counterfactual; valid before deployment). */
export async function getSmartAccountAddress(
  network: SpraayNetwork,
  wallet: WalletInfo,
): Promise<`0x${string}`> {
  const account = await getSmartAccount(network, wallet);
  return account.address;
}

export interface UserOpCall {
  to: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}

/**
 * Send a sponsored, atomically-batched UserOperation and wait for it to land.
 * Returns the settled L1/L2 transaction hash.
 */
export async function sendSponsoredCalls(
  network: SpraayNetwork,
  wallet: WalletInfo,
  url: string,
  calls: UserOpCall[],
): Promise<`0x${string}`> {
  const client = getPublicClient(network);
  const account = await getSmartAccount(network, wallet);
  const bundler = createBundlerClient({
    account,
    client,
    transport: http(url),
    // Use the same CDP endpoint for paymaster sponsorship (pm_* methods).
    paymaster: true,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userOpHash = await bundler.sendUserOperation({ calls: calls as any });
  const receipt = await bundler.waitForUserOperationReceipt({ hash: userOpHash });
  return receipt.receipt.transactionHash;
}

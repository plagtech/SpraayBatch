/**
 * USDC reads on Base: balance, decimals, symbol, allowance.
 * Non-custodial — reads only; spending is done in payout.ts.
 */

import type { PublicClient } from "viem";
import { ERC20_ABI } from "./abi.js";
import { networkInfo } from "./chains.js";
import type { SpraayNetwork } from "./config.js";
import { formatUsdc, USDC_DECIMALS } from "./amounts.js";

export interface UsdcBalance {
  raw: bigint;
  decimals: number;
  formatted: string;
  symbol: string;
}

export async function getDecimals(
  client: PublicClient,
  network: SpraayNetwork,
): Promise<number> {
  try {
    const d = await client.readContract({
      address: networkInfo(network).usdc,
      abi: ERC20_ABI,
      functionName: "decimals",
    });
    return Number(d);
  } catch {
    return USDC_DECIMALS;
  }
}

export async function getBalance(
  client: PublicClient,
  network: SpraayNetwork,
  address: `0x${string}`,
): Promise<UsdcBalance> {
  const usdc = networkInfo(network).usdc;
  const [raw, decimals, symbol] = await Promise.all([
    client.readContract({ address: usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
    getDecimals(client, network),
    client
      .readContract({ address: usdc, abi: ERC20_ABI, functionName: "symbol" })
      .catch(() => "USDC"),
  ]);
  return { raw, decimals, formatted: formatUsdc(raw, decimals), symbol };
}

export async function getAllowance(
  client: PublicClient,
  network: SpraayNetwork,
  owner: `0x${string}`,
  spender: `0x${string}`,
): Promise<bigint> {
  return client.readContract({
    address: networkInfo(network).usdc,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });
}

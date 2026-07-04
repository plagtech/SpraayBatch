/**
 * ERC-20 token reads on Base: balance, decimals, symbol, allowance.
 * Non-custodial — reads only; spending is done in payout.ts.
 *
 * Each read defaults to the network's USDC token but accepts an explicit token
 * address, so the same helpers serve any ERC-20 (see tokens.ts / resolveToken).
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

/** The token to read against — defaults to the network's USDC when omitted. */
function tokenAddress(network: SpraayNetwork, token?: `0x${string}`): `0x${string}` {
  return token ?? networkInfo(network).usdc;
}

export async function getDecimals(
  client: PublicClient,
  network: SpraayNetwork,
  token?: `0x${string}`,
): Promise<number> {
  try {
    const d = await client.readContract({
      address: tokenAddress(network, token),
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
  token?: `0x${string}`,
): Promise<UsdcBalance> {
  const tokenAddr = tokenAddress(network, token);
  const [raw, decimals, symbol] = await Promise.all([
    client.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
    getDecimals(client, network, tokenAddr),
    client
      .readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "symbol" })
      .catch(() => "USDC"),
  ]);
  return { raw, decimals, formatted: formatUsdc(raw, decimals), symbol };
}

export async function getAllowance(
  client: PublicClient,
  network: SpraayNetwork,
  owner: `0x${string}`,
  spender: `0x${string}`,
  token?: `0x${string}`,
): Promise<bigint> {
  return client.readContract({
    address: tokenAddress(network, token),
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });
}

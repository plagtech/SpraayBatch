/**
 * ERC-20 token resolution for batch payouts.
 *
 * The Spray contract is token-agnostic — `sprayToken`/`sprayEqual` take the token
 * address as a parameter — so SpraayBatch can pay out ANY standard ERC-20 on Base,
 * not just USDC (matching spraay.app). A token is referenced either by address
 * (0x…) or by a known symbol (USDC, WETH, DAI, …); anything else is resolved live
 * on-chain: we read its `decimals()` and `symbol()` and check its balance/allowance
 * exactly as we do for USDC.
 *
 * When no token is given we default to USDC for backwards compatibility.
 *
 * We do NOT keep an allowlist — any ERC-20 is accepted — but we DO keep a small
 * denylist of tokens whose transfer semantics break the batch accounting math:
 *
 *  - Fee-on-transfer tokens (e.g. PAXG) skim a cut on `transferFrom`, so the amount
 *    the contract receives — and forwards to recipients — is LESS than the amount we
 *    approved and the per-recipient figure we recorded. The ledger would lie.
 *  - Rebasing / elastic-supply tokens (e.g. stETH, AMPL) change balances out from
 *    under us: the balance can shrink between `approve` and the spray, reverting the
 *    exact-allowance `transferFrom`, or leave recipients with amounts that no longer
 *    match what we computed.
 *
 * Both classes violate the contract's assumption that `amount in === amount out`,
 * so we refuse them up front with a clear reason rather than send a wrong payout.
 */

import type { PublicClient } from "viem";
import { isAddress, getAddress } from "viem";
import { ERC20_ABI } from "./abi.js";
import { networkInfo } from "./chains.js";
import type { SpraayNetwork } from "./config.js";
import { USDC_DECIMALS } from "./amounts.js";

export interface TokenInfo {
  address: `0x${string}`;
  /** On-chain symbol (falls back to the requested symbol, then "TOKEN"). */
  symbol: string;
  /** On-chain decimals — drives all amount parsing/formatting. */
  decimals: number;
  /** True when this is the default token (USDC) because no token was specified. */
  isDefault: boolean;
}

/** Raised when a requested token is on the fee-on-transfer / rebasing denylist. */
export class DeniedTokenError extends Error {}
/** Raised when a symbol isn't in the known registry (pass a 0x address instead). */
export class UnknownTokenError extends Error {}

/**
 * Convenience registry so callers can use symbols instead of addresses for common
 * Base tokens. Keys are UPPERCASE for case-insensitive lookup. Any token not listed
 * here is still fully supported — pass its 0x address. Addresses are the canonical
 * Base deployments.
 */
export const KNOWN_TOKENS: Record<SpraayNetwork, Record<string, `0x${string}`>> = {
  base: {
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDBC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
    WETH: "0x4200000000000000000000000000000000000006",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    CBETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    CBBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
  },
  "base-sepolia": {
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    WETH: "0x4200000000000000000000000000000000000006",
  },
};

interface DeniedEntry {
  /** UPPERCASE symbols that identify this token. */
  symbols: string[];
  /** Lowercased addresses (any chain — cheap extra guard). */
  addresses: string[];
  reason: string;
}

/**
 * Tokens that break exact-amount batch accounting. Matched by on-chain symbol
 * (authoritative) OR address. Extend as new problematic tokens surface.
 */
const DENYLIST: DeniedEntry[] = [
  {
    symbols: ["STETH"],
    // Lido stETH (Ethereum mainnet) — kept as an extra guard; Base uses non-rebasing wstETH.
    addresses: ["0xae7ab96520de3a18e5e111b5eaab095312d7fe84"],
    reason:
      "stETH rebases daily (elastic balance); the sender's balance can change between approve and spray, breaking exact-amount batch payouts. Use the non-rebasing wrapped version (wstETH) instead.",
  },
  {
    symbols: ["AMPL", "AAMPL"],
    addresses: ["0xd46ba6d942050d489dbd938a2c909a5d5039a161"],
    reason:
      "Ampleforth (AMPL) has elastic/rebasing supply; balances change out from under the batch, so recorded per-recipient amounts would be wrong.",
  },
  {
    symbols: ["PAXG"],
    addresses: ["0x45804880de22913dafe09f4980848ece6ecbaf78"],
    reason:
      "PAX Gold (PAXG) charges a fee on transfer; recipients would receive less than the batch amount and the ledger would overstate what was paid.",
  },
];

/** Is this token (by symbol and/or address) on the denylist? Returns the reason if so. */
export function deniedReason(
  address: `0x${string}` | undefined,
  symbol: string | undefined,
): string | undefined {
  const sym = symbol?.trim().toUpperCase();
  const addr = address?.toLowerCase();
  for (const entry of DENYLIST) {
    if (sym && entry.symbols.includes(sym)) return entry.reason;
    if (addr && entry.addresses.includes(addr)) return entry.reason;
  }
  return undefined;
}

function assertNotDenied(address: `0x${string}` | undefined, symbol: string | undefined): void {
  const reason = deniedReason(address, symbol);
  if (reason) {
    throw new DeniedTokenError(
      `Token ${symbol ?? address ?? "?"} is not supported for batch payouts: ${reason}`,
    );
  }
}

interface ResolvedRef {
  address: `0x${string}`;
  /** The symbol the caller asked for, when they passed one (for denylist + fallback). */
  requestedSymbol?: string;
  isDefault: boolean;
}

/**
 * Pure address resolution (no chain access): default → USDC, 0x… → that address,
 * otherwise look the symbol up in KNOWN_TOKENS. Exported for unit testing.
 */
export function resolveTokenRef(network: SpraayNetwork, ref?: string): ResolvedRef {
  const trimmed = ref?.trim();
  if (!trimmed) {
    return { address: networkInfo(network).usdc, requestedSymbol: "USDC", isDefault: true };
  }
  if (isAddress(trimmed)) {
    return { address: getAddress(trimmed), isDefault: false };
  }
  const known = KNOWN_TOKENS[network][trimmed.toUpperCase()];
  if (known) {
    return { address: known, requestedSymbol: trimmed.toUpperCase(), isDefault: false };
  }
  const symbols = Object.keys(KNOWN_TOKENS[network]).join(", ");
  throw new UnknownTokenError(
    `Unknown token "${ref}" on ${network}. Pass a 0x token address, or a known symbol (${symbols}).`,
  );
}

/**
 * Resolve a token reference to full on-chain info: address, symbol, decimals.
 * Reads `decimals()` and `symbol()` live so any ERC-20 works. Rejects denylisted
 * (fee-on-transfer / rebasing) tokens before they can be paid out.
 */
export async function resolveToken(
  client: PublicClient,
  network: SpraayNetwork,
  ref?: string,
): Promise<TokenInfo> {
  const { address, requestedSymbol, isDefault } = resolveTokenRef(network, ref);

  // Fast reject if the caller named a denylisted symbol/address before hitting the chain.
  assertNotDenied(address, requestedSymbol);

  const [decimals, symbol] = await Promise.all([
    client
      .readContract({ address, abi: ERC20_ABI, functionName: "decimals" })
      .then((d) => Number(d))
      .catch((e) => {
        // The default token (USDC) is known to be 6 decimals — stay resilient to an RPC
        // hiccup. For an arbitrary token we can't guess: refuse rather than risk bad math.
        if (isDefault) return USDC_DECIMALS;
        throw new Error(
          `Could not read decimals() for token ${address} — is it a standard ERC-20? (${
            e instanceof Error ? e.message : String(e)
          })`,
        );
      }),
    client
      .readContract({ address, abi: ERC20_ABI, functionName: "symbol" })
      .then((s) => String(s))
      .catch(() => requestedSymbol ?? "TOKEN"),
  ]);

  // The on-chain symbol is authoritative — re-check the denylist against it.
  assertNotDenied(address, symbol);

  return { address, symbol, decimals, isDefault };
}

/**
 * USDC amount parsing/formatting and recipient validation.
 *
 * All on-chain math is done in integer base units (bigint) to avoid floating-point
 * money bugs. USDC has 6 decimals on Base and Base Sepolia; callers may override.
 */

import { getAddress, isAddress } from "viem";

export const USDC_DECIMALS = 6;

/**
 * Parse a human-readable amount ("100", "12.50") into base units.
 * Rejects negatives, NaN, blanks, and more fractional digits than `decimals`.
 */
export function parseUsdc(value: string, decimals: number = USDC_DECIMALS): bigint {
  const s = value.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid amount "${value}" — expected a non-negative decimal number.`);
  }
  const [whole, frac = ""] = s.split(".");
  if (frac.length > decimals) {
    throw new Error(
      `Amount "${value}" has more than ${decimals} decimal places (the token's precision).`,
    );
  }
  const padded = frac.padEnd(decimals, "0");
  const base = BigInt(whole ?? "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
  if (base <= 0n) {
    throw new Error(`Amount "${value}" must be greater than zero.`);
  }
  return base;
}

/** Format base units back to a human-readable string (trimmed of trailing zeros). */
export function formatUsdc(base: bigint, decimals: number = USDC_DECIMALS): string {
  const neg = base < 0n;
  const abs = neg ? -base : base;
  const denom = 10n ** BigInt(decimals);
  const whole = abs / denom;
  const frac = abs % denom;
  let out = whole.toString();
  if (frac > 0n) {
    const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
    out += `.${fracStr}`;
  }
  return neg ? `-${out}` : out;
}

export interface ParsedRecipient {
  address: `0x${string}`;
  amount: bigint;
}

/**
 * Validate + normalize recipients for a per-amount (sprayToken) payout.
 * Checksums addresses, parses amounts, rejects empties/mismatches/duplicates.
 */
export function parseRecipients(
  recipients: string[],
  amounts: string[],
  decimals: number = USDC_DECIMALS,
): ParsedRecipient[] {
  if (recipients.length === 0) {
    throw new Error("No recipients provided.");
  }
  if (recipients.length !== amounts.length) {
    throw new Error(
      `recipients (${recipients.length}) and amounts (${amounts.length}) must be the same length.`,
    );
  }
  return recipients.map((addr, i) => {
    if (!isAddress(addr)) {
      throw new Error(`Recipient #${i + 1} is not a valid address: ${addr}`);
    }
    const amountStr = amounts[i];
    if (amountStr === undefined) {
      throw new Error(`Missing amount for recipient #${i + 1}.`);
    }
    return { address: getAddress(addr), amount: parseUsdc(amountStr, decimals) };
  });
}

/**
 * Validate addresses for an equal-amount (sprayEqual) payout.
 */
export function parseAddresses(recipients: string[]): `0x${string}`[] {
  if (recipients.length === 0) {
    throw new Error("No recipients provided.");
  }
  return recipients.map((addr, i) => {
    if (!isAddress(addr)) {
      throw new Error(`Recipient #${i + 1} is not a valid address: ${addr}`);
    }
    return getAddress(addr);
  });
}

/** Are all amounts identical? (chooses sprayEqual vs sprayToken) */
export function allEqual(amounts: bigint[]): boolean {
  if (amounts.length === 0) return false;
  const first = amounts[0];
  return amounts.every((a) => a === first);
}

/** Sum base-unit amounts. */
export function sum(amounts: bigint[]): bigint {
  return amounts.reduce((acc, a) => acc + a, 0n);
}

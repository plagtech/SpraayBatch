/**
 * Wallet resolution for SpraayBatch.
 *
 * Ported from spraay-x402-mcp (src/wallet.ts) to keep the zero-config UX identical:
 * the user installs, funds an address, and never has to configure a key. Resolution
 * order:
 *
 *   1. explicit key (plugin config `walletKey` or EVM_PRIVATE_KEY env) — always wins.
 *   2. ~/.spraay/.session — a key persisted from a previous run.
 *   3. (first run) generate a fresh key, persist it 0600, and use it.
 *
 * SECURITY: the private key is NEVER logged or transmitted. Only the address is
 * surfaced. The one place the key is shown is the explicit, user-invoked
 * `export-key` command (see cli.ts) — for backup.
 *
 * SAFETY (hardened beyond the MCP original, per ClawRouter's pattern): if the
 * session file EXISTS but is unreadable or malformed, we REFUSE to auto-generate a
 * new wallet — silently minting a fresh key would strand funds on the old address.
 * The caller must fix the file or pass an explicit key.
 *
 * v0.1 uses a single raw private key for consistency with spraay-x402-mcp.
 * Recoverable BIP-39 mnemonic wallets are a planned v0.2 upgrade.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { SPRAAY_DIR, SESSION_FILE } from "./paths.js";

export type WalletSource = "config" | "env" | "session" | "generated";

export interface WalletInfo {
  privateKey: `0x${string}`;
  address: `0x${string}`;
  source: WalletSource;
}

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export function isValidKey(k: string | undefined | null): k is `0x${string}` {
  return !!k && KEY_RE.test(k.trim());
}

/** Thrown when the session file exists but cannot be used, to avoid clobbering funds. */
export class WalletFileError extends Error {}

function accountAddress(pk: `0x${string}`): `0x${string}` {
  return privateKeyToAccount(pk).address;
}

/**
 * Resolve the signing wallet, creating and persisting one on first run.
 *
 * @param explicitKey optional key from plugin config (`walletKey`); highest priority
 *        after being validated. Invalid values are ignored with a caller-visible signal
 *        via the returned source (never "config").
 */
export function resolveWallet(explicitKey?: string): WalletInfo {
  // 1a. Plugin-config override.
  if (isValidKey(explicitKey)) {
    const pk = explicitKey.trim() as `0x${string}`;
    return { privateKey: pk, address: accountAddress(pk), source: "config" };
  }

  // 1b. Environment override.
  const envKey = process.env.EVM_PRIVATE_KEY;
  if (isValidKey(envKey)) {
    const pk = envKey.trim() as `0x${string}`;
    return { privateKey: pk, address: accountAddress(pk), source: "env" };
  }

  // 2. Reuse a persisted session key.
  if (existsSync(SESSION_FILE)) {
    let saved: string;
    try {
      saved = readFileSync(SESSION_FILE, "utf-8").trim();
    } catch (e) {
      // File exists but unreadable — refuse to mint a replacement.
      throw new WalletFileError(
        `Wallet file at ${SESSION_FILE} exists but could not be read (${
          e instanceof Error ? e.message : String(e)
        }). Refusing to auto-generate a new wallet to protect existing funds. ` +
          `Fix permissions or set EVM_PRIVATE_KEY.`,
      );
    }
    if (!isValidKey(saved)) {
      throw new WalletFileError(
        `Wallet file at ${SESSION_FILE} exists but is not a valid key ` +
          `(expected 0x + 64 hex chars). Refusing to auto-generate a new wallet ` +
          `to protect existing funds. Restore your backup or set EVM_PRIVATE_KEY.`,
      );
    }
    const pk = saved as `0x${string}`;
    return { privateKey: pk, address: accountAddress(pk), source: "session" };
  }

  // 3. First run: generate, persist 0600, return.
  const pk = generatePrivateKey();
  try {
    mkdirSync(SPRAAY_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(SESSION_FILE, pk, { mode: 0o600 });
    try {
      chmodSync(SESSION_FILE, 0o600);
    } catch {
      /* best-effort on non-POSIX filesystems */
    }
  } catch (e) {
    // Persisting failed — surface it rather than silently using an ephemeral key
    // that would be lost (and its funds with it) on next run.
    throw new WalletFileError(
      `Could not persist a new wallet to ${SESSION_FILE} (${
        e instanceof Error ? e.message : String(e)
      }). Set EVM_PRIVATE_KEY or fix directory permissions.`,
    );
  }
  return { privateKey: pk, address: accountAddress(pk), source: "generated" };
}

/** Does an auto-created wallet already exist on disk? */
export function walletExists(): boolean {
  return existsSync(SESSION_FILE);
}

/**
 * Return the raw private key for backup. USER-INVOKED ONLY (export-key command).
 * Never call this from logging or any network path.
 */
export function exportPrivateKey(): `0x${string}` {
  return resolveWallet().privateKey;
}

/** Human-readable, address-only summary for logs. NEVER includes the key. */
export function describeWallet(w: WalletInfo): string {
  switch (w.source) {
    case "config":
      return `Wallet (from plugin config): ${w.address}`;
    case "env":
      return `Wallet (from EVM_PRIVATE_KEY): ${w.address}`;
    case "session":
      return `Wallet (${SESSION_FILE}): ${w.address}`;
    case "generated":
      return `Created a new wallet: ${w.address} — fund it with USDC on Base. Back it up with \`spraay-batch export-key\`.`;
  }
}

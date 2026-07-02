/**
 * SpraayPay configuration, persisted at ~/.spraay/spraaypay.json.
 *
 * Written atomically (temp file + rename) and readable/writable only by the user
 * (0600). Loading is tolerant: a missing file yields defaults; a corrupt file is
 * backed up rather than overwritten, then defaults are returned — so a bad edit
 * never silently discards a user's settings.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
} from "node:fs";
import { SPRAAY_DIR, CONFIG_FILE } from "./paths.js";

export type SpraayNetwork = "base" | "base-sepolia";

export interface SponsorshipConfig {
  /** Sponsor gas via the CDP Paymaster so USDC-only agents can transact (Phase 3). */
  enabled: boolean;
  /** Optional ceiling on sponsored gas spend; enforcement added later. */
  capUsd?: number;
}

export interface SpraayConfig {
  version: number;
  /** Default network. Starts on testnet — mainnet is an explicit opt-in. */
  network: SpraayNetwork;
  sponsorship: SponsorshipConfig;
  /**
   * CDP Paymaster & Bundler RPC URL (https://api.developer.coinbase.com/rpc/v1/base/<KEY>).
   * When set (and sponsorship.enabled), batch payouts run gasless via an ERC-4337 smart
   * account. Can also be supplied via CDP_PAYMASTER_URL / SPRAAY_PAYMASTER_URL env vars.
   */
  paymasterUrl?: string;
}

export const CONFIG_VERSION = 1;

export const DEFAULT_CONFIG: SpraayConfig = {
  version: CONFIG_VERSION,
  network: "base-sepolia",
  sponsorship: { enabled: true },
};

function coerce(raw: unknown): SpraayConfig {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const network: SpraayNetwork = obj.network === "base" ? "base" : "base-sepolia";
  const rawSpon = (obj.sponsorship ?? {}) as Record<string, unknown>;
  const sponsorship: SponsorshipConfig = {
    enabled: rawSpon.enabled !== false,
    ...(typeof rawSpon.capUsd === "number" && rawSpon.capUsd > 0
      ? { capUsd: rawSpon.capUsd }
      : {}),
  };
  const paymasterUrl =
    typeof obj.paymasterUrl === "string" && obj.paymasterUrl.trim()
      ? obj.paymasterUrl.trim()
      : undefined;
  return {
    version: CONFIG_VERSION,
    network,
    sponsorship,
    ...(paymasterUrl ? { paymasterUrl } : {}),
  };
}

/** Load config, returning defaults when absent. Backs up (never clobbers) a corrupt file. */
export function loadConfig(): SpraayConfig {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
  let text: string;
  try {
    text = readFileSync(CONFIG_FILE, "utf-8").trim();
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  if (!text) return { ...DEFAULT_CONFIG };
  try {
    return coerce(JSON.parse(text));
  } catch {
    // Corrupt JSON — preserve it for the user instead of overwriting.
    try {
      copyFileSync(CONFIG_FILE, `${CONFIG_FILE}.corrupt`);
    } catch {
      /* best-effort */
    }
    return { ...DEFAULT_CONFIG };
  }
}

/** Persist config atomically with 0600 perms. */
export function saveConfig(config: SpraayConfig): void {
  mkdirSync(SPRAAY_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${CONFIG_FILE}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  renameSync(tmp, CONFIG_FILE);
}

/**
 * Ensure a config file exists, creating it from defaults on first run.
 * Returns the effective config.
 */
export function ensureConfig(overrides?: Partial<SpraayConfig>): SpraayConfig {
  const existed = existsSync(CONFIG_FILE);
  const config = { ...loadConfig(), ...overrides };
  if (!existed || overrides) saveConfig(config);
  return config;
}

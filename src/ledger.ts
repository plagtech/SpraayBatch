/**
 * Append-only payment ledger at ~/.spraay/ledger.jsonl (one JSON object per line).
 *
 * Every executed payout is recorded with its recipients, payout total, fee, total
 * cost, tx hash, and Basescan link. Append-only: we never rewrite prior lines.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { SPRAAY_DIR, LEDGER_FILE } from "./paths.js";
import type { SpraayNetwork } from "./config.js";

export interface LedgerEntry {
  timestamp: string; // ISO 8601
  network: SpraayNetwork;
  type: "batch";
  method: "sprayEqual" | "sprayToken";
  token: string; // e.g. "USDC"
  recipientCount: number;
  recipients: string[];
  amounts: string[]; // human-readable, per recipient
  payout: string; // human-readable sum to recipients
  fee: string; // human-readable protocol fee
  totalCost: string; // human-readable payout + fee
  txHash: string;
  explorer: string;
  agentId?: string;
}

/** Append one entry to the ledger (creates the file/dir on first write). */
export function appendLedger(entry: LedgerEntry): void {
  mkdirSync(SPRAAY_DIR, { recursive: true, mode: 0o700 });
  appendFileSync(LEDGER_FILE, JSON.stringify(entry) + "\n", { mode: 0o600 });
}

/**
 * Read the most recent `limit` entries, newest first. When `token` is given (a
 * symbol like "USDC"/"WETH", case-insensitive), only that token's payouts are
 * returned — filtered before the limit is applied.
 */
export function readReceipts(limit = 10, token?: string): LedgerEntry[] {
  if (!existsSync(LEDGER_FILE)) return [];
  let text: string;
  try {
    text = readFileSync(LEDGER_FILE, "utf-8");
  } catch {
    return [];
  }
  const wanted = token?.trim().toUpperCase();
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const entries: LedgerEntry[] = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LedgerEntry;
      if (!wanted || entry.token?.toUpperCase() === wanted) entries.push(entry);
    } catch {
      /* skip a corrupt line rather than fail the whole read */
    }
  }
  return entries.slice(-limit).reverse();
}

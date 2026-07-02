/**
 * Canonical on-disk locations for SpraayPay runtime state, all under ~/.spraay/.
 * Centralized so wallet, config, budgets, and ledger agree on where things live.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/** Root directory for all SpraayPay local state. Created with 0700. */
export const SPRAAY_DIR = join(homedir(), ".spraay");

/** Auto-created wallet private key (0600). Ported convention from spraay-x402-mcp. */
export const SESSION_FILE = join(SPRAAY_DIR, ".session");

/** Plugin configuration. */
export const CONFIG_FILE = join(SPRAAY_DIR, "spraaypay.json");

/** Per-agent budget caps + spend history (Phase 2). */
export const BUDGETS_FILE = join(SPRAAY_DIR, "budgets.json");

/** Append-only payment ledger (Phase 2). */
export const LEDGER_FILE = join(SPRAAY_DIR, "ledger.jsonl");

/**
 * Per-agent spend budgets.
 *
 * A parent agent sets a spend cap per sub-agent (agent_id → limit). Once cumulative
 * spend reaches the cap, further payouts for that agent are blocked. Amounts are
 * tracked in USDC base units (bigint) to avoid floating-point money bugs; persisted
 * as decimal strings in ~/.spraay/budgets.json (0600, atomic write).
 *
 * An agent with no cap set is unlimited; spend is still recorded for reporting.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
} from "node:fs";
import { SPRAAY_DIR, BUDGETS_FILE } from "./paths.js";
import { formatUsdc } from "./amounts.js";

interface AgentBudgetRaw {
  /** Cap in base units as a decimal string, or null for uncapped. */
  limit: string | null;
  /** Cumulative spend in base units as a decimal string. */
  spent: string;
}

interface BudgetFile {
  version: number;
  agents: Record<string, AgentBudgetRaw>;
}

const BUDGET_VERSION = 1;

export interface BudgetStatus {
  agentId: string;
  limit: bigint | null;
  spent: bigint;
  remaining: bigint | null;
  limitFormatted: string | null;
  spentFormatted: string;
  remainingFormatted: string | null;
}

export interface BudgetCheck {
  allowed: boolean;
  remaining: bigint | null;
  reason?: string;
}

export class BudgetStore {
  private agents = new Map<string, { limit: bigint | null; spent: bigint }>();

  constructor(private readonly file: string = BUDGETS_FILE) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    let text: string;
    try {
      text = readFileSync(this.file, "utf-8").trim();
    } catch {
      return;
    }
    if (!text) return;
    let parsed: BudgetFile;
    try {
      parsed = JSON.parse(text) as BudgetFile;
    } catch {
      try {
        copyFileSync(this.file, `${this.file}.corrupt`);
      } catch {
        /* best-effort */
      }
      return;
    }
    for (const [id, raw] of Object.entries(parsed.agents ?? {})) {
      try {
        this.agents.set(id, {
          limit: raw.limit === null || raw.limit === undefined ? null : BigInt(raw.limit),
          spent: BigInt(raw.spent ?? "0"),
        });
      } catch {
        /* skip malformed entry */
      }
    }
  }

  private save(): void {
    const out: BudgetFile = { version: BUDGET_VERSION, agents: {} };
    for (const [id, b] of this.agents) {
      out.agents[id] = { limit: b.limit === null ? null : b.limit.toString(), spent: b.spent.toString() };
    }
    mkdirSync(SPRAAY_DIR, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(out, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  private ensure(agentId: string): { limit: bigint | null; spent: bigint } {
    let b = this.agents.get(agentId);
    if (!b) {
      b = { limit: null, spent: 0n };
      this.agents.set(agentId, b);
    }
    return b;
  }

  /** Set (or clear, with null) an agent's cap, in base units. */
  setLimit(agentId: string, limit: bigint | null): void {
    if (limit !== null && limit < 0n) throw new Error("Budget limit must be non-negative.");
    this.ensure(agentId).limit = limit;
    this.save();
  }

  /** Would spending `amount` (base units) be allowed for this agent right now? */
  check(agentId: string, amount: bigint): BudgetCheck {
    const b = this.agents.get(agentId);
    if (!b || b.limit === null) return { allowed: true, remaining: null };
    const remaining = b.limit - b.spent;
    if (amount > remaining) {
      return {
        allowed: false,
        remaining,
        reason: `Budget exceeded for agent "${agentId}": needs ${formatUsdc(
          amount,
        )} but only ${formatUsdc(remaining < 0n ? 0n : remaining)} of ${formatUsdc(
          b.limit,
        )} remains.`,
      };
    }
    return { allowed: true, remaining };
  }

  /** Record spend (base units) against an agent, creating an uncapped entry if new. */
  record(agentId: string, amount: bigint): void {
    if (amount < 0n) throw new Error("Recorded spend must be non-negative.");
    this.ensure(agentId).spent += amount;
    this.save();
  }

  status(agentId: string): BudgetStatus {
    const b = this.agents.get(agentId) ?? { limit: null, spent: 0n };
    const remaining = b.limit === null ? null : b.limit - b.spent;
    return {
      agentId,
      limit: b.limit,
      spent: b.spent,
      remaining,
      limitFormatted: b.limit === null ? null : formatUsdc(b.limit),
      spentFormatted: formatUsdc(b.spent),
      remainingFormatted: remaining === null ? null : formatUsdc(remaining < 0n ? 0n : remaining),
    };
  }

  list(): BudgetStatus[] {
    return [...this.agents.keys()].map((id) => this.status(id));
  }

  resetSpent(agentId: string): void {
    const b = this.agents.get(agentId);
    if (b) {
      b.spent = 0n;
      this.save();
    }
  }
}

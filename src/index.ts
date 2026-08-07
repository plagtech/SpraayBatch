/**
 * SpraayBatch — OpenClaw plugin entry point.
 *
 * Agent-native, gasless batch ERC-20 payments on Base (any token; defaults to
 * USDC). Wires the plugin into OpenClaw,
 * ensures local config, auto-resolves a non-custodial wallet, and registers the
 * payment surface (Phase 2): wallet/balance, per-agent budgets, batch payout, and
 * the receipts ledger. Exposed three ways, priority: agent tools (primary),
 * slash-commands, and a bundled skill.
 *
 * Integration pattern mirrors ./reference/ClawRouter but carries NONE of its
 * routing/proxy/model logic — SpraayBatch is money-out, not inference-routing.
 */

import type {
  OpenClawPluginApi,
  OpenClawPluginDefinition,
  OpenClawToolDefinition,
  OpenClawPluginCommandDefinition,
} from "./openclaw.js";
import { ensureConfig, type SpraayConfig } from "./config.js";
import {
  resolveWallet,
  describeWallet,
  WalletFileError,
  type WalletInfo,
} from "./wallet.js";
import { CONFIG_FILE, SESSION_FILE } from "./paths.js";
import { VERSION } from "./version.js";
import { addressUrl, getPublicClient, networkInfo } from "./chains.js";
import { getBalance } from "./usdc.js";
import { resolveTokenRef } from "./tokens.js";
import { gaslessActive, paymasterUrl, getSmartAccountAddress } from "./gasless.js";
import { parseUsdc, formatUsdc } from "./amounts.js";
import { BudgetStore } from "./budgets.js";
import { readReceipts } from "./ledger.js";
import {
  planBatchPayout,
  executeBatchPayout,
  RequiresMainnetConfirmationError,
  type PayoutPlan,
  type PayoutRequest,
} from "./payout.js";

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function readOverrides(api: OpenClawPluginApi): Partial<SpraayConfig> {
  const pc = api.pluginConfig ?? {};
  const overrides: Partial<SpraayConfig> = {};
  if (pc.network === "base" || pc.network === "base-sepolia") {
    overrides.network = pc.network;
  }
  if (pc.sponsorship && typeof pc.sponsorship === "object") {
    const s = pc.sponsorship as Record<string, unknown>;
    overrides.sponsorship = {
      enabled: s.enabled !== false,
      ...(typeof s.capUsd === "number" && s.capUsd > 0 ? { capUsd: s.capUsd } : {}),
    };
  }
  if (typeof pc.paymasterUrl === "string" && pc.paymasterUrl.trim()) {
    overrides.paymasterUrl = pc.paymasterUrl.trim();
  }
  return overrides;
}

/** The address that funds payouts: smart account when gasless, else the EOA. */
async function fundingAddress(config: SpraayConfig, wallet: WalletInfo): Promise<`0x${string}`> {
  return gaslessActive(config)
    ? getSmartAccountAddress(config.network, wallet)
    : wallet.address;
}

/** Gasless routing fields for a PayoutRequest, when sponsorship is active. */
function gaslessFields(config: SpraayConfig): Pick<PayoutRequest, "gasless" | "paymasterUrl"> {
  return gaslessActive(config)
    ? { gasless: true, paymasterUrl: paymasterUrl(config) as string }
    : {};
}

function summarizePlan(plan: PayoutPlan) {
  return {
    method: plan.method,
    network: plan.network,
    token: plan.token,
    gasless: plan.gasless,
    payer: plan.payer,
    recipientCount: plan.recipientCount,
    payout: plan.payoutFormatted,
    fee: plan.feeFormatted,
    totalCost: plan.totalCostFormatted,
    needsApproval: plan.needsApproval,
    balanceOk: plan.balanceOk,
    paused: plan.paused,
    withinMax: plan.withinMax,
    budgetRemaining:
      plan.budget.remaining === null ? null : formatUsdc(plan.budget.remaining),
  };
}

// ---------------------------------------------------------------------------
// Agent tools (primary surface)
// ---------------------------------------------------------------------------

function buildTools(
  wallet: WalletInfo,
  config: SpraayConfig,
  budgets: BudgetStore,
): OpenClawToolDefinition[] {
  const network = config.network;

  const gasless = gaslessActive(config);

  const walletInfo: OpenClawToolDefinition = {
    name: "spraay_wallet_info",
    description:
      "Report the SpraayBatch funding address, owner address, active Base network, gasless status, " +
      "and funding link. When gasless is active, fund the SMART ACCOUNT (fundingAddress) — no ETH " +
      "needed. Read-only; never returns the private key.",
    parameters: { type: "object", properties: {}, required: [] },
    execute: async () => {
      try {
        const funding = await fundingAddress(config, wallet);
        return {
          ok: true,
          fundingAddress: funding,
          ownerAddress: wallet.address,
          gasless,
          network,
          explorer: addressUrl(network, funding),
          note: gasless
            ? "Gasless active — fund the SMART ACCOUNT (fundingAddress) with USDC; zero ETH needed."
            : "Fund fundingAddress with USDC. You also need ETH for gas — set a CDP paymaster URL to go gasless.",
        };
      } catch (e) {
        return { ok: false, error: msg(e) };
      }
    },
  };

  const balance: OpenClawToolDefinition = {
    name: "spraay_balance",
    description:
      "Get the funding address's live token balance on the active Base network (the smart account " +
      "when gasless). Defaults to USDC; pass `token` (a 0x address or known symbol) for any ERC-20.",
    parameters: {
      type: "object",
      properties: {
        token: {
          type: "string",
          description: "Token to check: a 0x address or known symbol (USDC, WETH, DAI, ...). Omit for USDC.",
        },
      },
      required: [],
    },
    execute: async (_id, params) => {
      try {
        const funding = await fundingAddress(config, wallet);
        const tokenAddr = resolveTokenRef(network, params.token as string | undefined).address;
        const bal = await getBalance(getPublicClient(network), network, funding, tokenAddr);
        return {
          ok: true,
          address: funding,
          gasless,
          network,
          symbol: bal.symbol,
          balance: bal.formatted,
        };
      } catch (e) {
        return { ok: false, error: msg(e) };
      }
    },
  };

  const budgetSet: OpenClawToolDefinition = {
    name: "spraay_budget_set",
    description:
      "Set (or clear) a spend cap for a sub-agent, in USDC. Once cumulative spend reaches the " +
      "cap, that agent's payouts are blocked. Pass limit_usdc as a number string, or omit / set " +
      "to 'none' to remove the cap.",
    parameters: {
      type: "object",
      properties: {
        agent_id: { type: "string", description: "The sub-agent's id." },
        limit_usdc: {
          type: "string",
          description: "Cap in USDC (e.g. '100'), or 'none' to clear the cap.",
        },
      },
      required: ["agent_id"],
    },
    execute: async (_id, params) => {
      try {
        const agentId = String(params.agent_id);
        const raw = params.limit_usdc;
        if (raw === undefined || raw === null || raw === "" || raw === "none") {
          budgets.setLimit(agentId, null);
          return { ok: true, agent_id: agentId, limit: null, note: "Cap cleared (uncapped)." };
        }
        const limit = parseUsdc(String(raw));
        budgets.setLimit(agentId, limit);
        return { ok: true, agent_id: agentId, limit: formatUsdc(limit) };
      } catch (e) {
        return { ok: false, error: msg(e) };
      }
    },
  };

  const budgetStatus: OpenClawToolDefinition = {
    name: "spraay_budget_status",
    description:
      "Show budget status for one sub-agent (agent_id) or all agents (omit agent_id). " +
      "Reports limit, spent, and remaining in USDC.",
    parameters: {
      type: "object",
      properties: { agent_id: { type: "string", description: "Optional sub-agent id." } },
      required: [],
    },
    execute: async (_id, params) => {
      try {
        if (params.agent_id) {
          const s = budgets.status(String(params.agent_id));
          return {
            ok: true,
            agent_id: s.agentId,
            limit: s.limitFormatted,
            spent: s.spentFormatted,
            remaining: s.remainingFormatted,
          };
        }
        return {
          ok: true,
          agents: budgets.list().map((s) => ({
            agent_id: s.agentId,
            limit: s.limitFormatted,
            spent: s.spentFormatted,
            remaining: s.remainingFormatted,
          })),
        };
      } catch (e) {
        return { ok: false, error: msg(e) };
      }
    },
  };

  const batchPay: OpenClawToolDefinition = {
    name: "spraay_batch_pay",
    description:
      "Pay multiple recipients in one atomic transaction on Base. Pays USDC by default; set " +
      "`token` to any ERC-20 (a 0x address or a known symbol like WETH/DAI/cbBTC) to pay that " +
      "token instead. Provide `amount` to pay the same amount to everyone (cheaper), or " +
      "`amounts` for per-recipient amounts (amounts are in the chosen token's units). Set " +
      "`dry_run: true` to preview cost/fee without sending. Mainnet (base) charges a 0.30% " +
      "protocol fee added on top of the payout (e.g. a 1000-token batch = 3-token fee), so the " +
      "sender must hold payout + fee; Base Sepolia is free. Use `dry_run` to see the exact fee " +
      "first. Mainnet sends require `confirm_mainnet: true`. Fee-on-transfer and rebasing tokens " +
      "are rejected. Amounts and fee are validated on-chain before signing.",
    parameters: {
      type: "object",
      properties: {
        recipients: {
          type: "array",
          items: { type: "string" },
          description: "Recipient addresses (0x...).",
        },
        token: {
          type: "string",
          description:
            "Token to pay: a 0x address or a known symbol (USDC, WETH, DAI, cbBTC, ...). Omit for USDC.",
        },
        amount: {
          type: "string",
          description: "Token amount paid to EVERY recipient (use this OR amounts).",
        },
        amounts: {
          type: "array",
          items: { type: "string" },
          description: "Per-recipient token amounts, same length/order as recipients.",
        },
        agent_id: { type: "string", description: "Sub-agent to bill (enforces its budget)." },
        dry_run: { type: "boolean", description: "Preview only; do not send." },
        confirm_mainnet: { type: "boolean", description: "Required to send on Base mainnet." },
      },
      required: ["recipients"],
    },
    execute: async (_id, params) => {
      try {
        const req: PayoutRequest = {
          network,
          wallet,
          recipients: (params.recipients as string[]) ?? [],
          ...(params.token !== undefined ? { token: String(params.token) } : {}),
          ...(params.amounts !== undefined ? { amounts: params.amounts as string[] } : {}),
          ...(params.amount !== undefined ? { amount: String(params.amount) } : {}),
          ...(params.agent_id !== undefined ? { agentId: String(params.agent_id) } : {}),
          ...gaslessFields(config),
        };
        if (params.dry_run === true) {
          const plan = await planBatchPayout(req, { budgetStore: budgets });
          return { ok: true, dryRun: true, ...summarizePlan(plan) };
        }
        const res = await executeBatchPayout(req, {
          budgetStore: budgets,
          confirmMainnet: params.confirm_mainnet === true,
        });
        return {
          ok: true,
          txHash: res.txHash,
          approvalTxHash: res.approvalTxHash,
          explorer: res.explorer,
          ...summarizePlan(res.plan),
        };
      } catch (e) {
        if (e instanceof RequiresMainnetConfirmationError) {
          return { ok: false, requiresConfirmation: true, error: msg(e) };
        }
        return { ok: false, error: msg(e) };
      }
    },
  };

  const receipts: OpenClawToolDefinition = {
    name: "spraay_receipts",
    description:
      "List recent payments from the local ledger (newest first), with Basescan links. " +
      "Pass `token` (a symbol like USDC/WETH) to show only payouts of that token.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max entries (default 10)." },
        token: { type: "string", description: "Optional token symbol filter (e.g. USDC, WETH)." },
      },
      required: [],
    },
    execute: async (_id, params) => {
      try {
        const limit = typeof params.limit === "number" ? params.limit : 10;
        return { ok: true, receipts: readReceipts(limit, params.token as string | undefined) };
      } catch (e) {
        return { ok: false, error: msg(e) };
      }
    },
  };

  return [walletInfo, balance, budgetSet, budgetStatus, batchPay, receipts];
}

// ---------------------------------------------------------------------------
// Slash-commands (for humans testing)
// ---------------------------------------------------------------------------

function buildCommands(
  wallet: WalletInfo,
  config: SpraayConfig,
  budgets: BudgetStore,
): OpenClawPluginCommandDefinition[] {
  const network = config.network;

  const gasless = gaslessActive(config);

  const wallet_: OpenClawPluginCommandDefinition = {
    name: "wallet",
    description: "Show your SpraayBatch funding address, network, gasless status, and funding link.",
    handler: async () => {
      try {
        const funding = await fundingAddress(config, wallet);
        return {
          text: [
            `Funding address${gasless ? " (smart account)" : ""}: ${funding}`,
            `Owner (signer): ${wallet.address}`,
            `Network: ${network}`,
            `Explorer: ${addressUrl(network, funding)}`,
            `Gasless: ${gasless ? "on — zero ETH needed" : "off (set a CDP paymaster URL)"}`,
            `Config: ${CONFIG_FILE}`,
            "",
            "Fund the funding address with USDC. Back up your key with:  spraay-batch export-key",
          ].join("\n"),
        };
      } catch (e) {
        return { isError: true, text: `Wallet error: ${msg(e)}` };
      }
    },
  };

  const balance_: OpenClawPluginCommandDefinition = {
    name: "balance",
    description: "Show your funding address's live token balance. `/balance [token]` (defaults to USDC).",
    acceptsArgs: true,
    handler: async (ctx) => {
      try {
        const funding = await fundingAddress(config, wallet);
        const tokenRef = (ctx.args ?? "").trim() || undefined;
        const tokenAddr = resolveTokenRef(network, tokenRef).address;
        const bal = await getBalance(getPublicClient(network), network, funding, tokenAddr);
        return { text: `Balance: ${bal.formatted} ${bal.symbol} on ${network} (${funding})` };
      } catch (e) {
        return { isError: true, text: `Balance error: ${msg(e)}` };
      }
    },
  };

  const budget_: OpenClawPluginCommandDefinition = {
    name: "budget",
    description: "Manage per-agent caps: `/budget set <agentId> <usdc>` | `clear <agentId>` | `status [agentId]`",
    acceptsArgs: true,
    handler: (ctx) => {
      const [sub, a, b] = (ctx.args ?? "").trim().split(/\s+/);
      try {
        if (sub === "set" && a && b) {
          budgets.setLimit(a, parseUsdc(b));
          return { text: `Cap for "${a}" set to ${b} USDC.` };
        }
        if (sub === "clear" && a) {
          budgets.setLimit(a, null);
          return { text: `Cap for "${a}" cleared.` };
        }
        if (sub === "status" || sub === undefined || sub === "") {
          const rows = a ? [budgets.status(a)] : budgets.list();
          if (rows.length === 0) return { text: "No budgets set." };
          return {
            text: rows
              .map(
                (s) =>
                  `${s.agentId}: spent ${s.spentFormatted}${
                    s.limitFormatted ? ` / ${s.limitFormatted}` : " (uncapped)"
                  }${s.remainingFormatted ? ` — ${s.remainingFormatted} left` : ""}`,
              )
              .join("\n"),
          };
        }
        return { isError: true, text: "Usage: /budget set <agentId> <usdc> | clear <agentId> | status [agentId]" };
      } catch (e) {
        return { isError: true, text: `Budget error: ${msg(e)}` };
      }
    },
  };

  const receipts_: OpenClawPluginCommandDefinition = {
    name: "receipts",
    description: "Show recent payments. `/receipts [limit] [tokenSymbol]`",
    acceptsArgs: true,
    handler: (ctx) => {
      // Args are order-independent: a bare number is the limit, anything else a token filter.
      let limit = 10;
      let token: string | undefined;
      for (const t of (ctx.args ?? "").trim().split(/\s+/).filter(Boolean)) {
        if (t === "--token") continue;
        if (/^\d+$/.test(t)) limit = parseInt(t, 10);
        else token = t;
      }
      const rows = readReceipts(limit, token);
      if (rows.length === 0) return { text: token ? `No ${token.toUpperCase()} payments yet.` : "No payments yet." };
      return {
        text: rows
          .map(
            (r) =>
              `${r.timestamp} — ${r.method} ${r.payout} ${r.token} (+${r.fee} fee) to ${r.recipientCount} → ${r.explorer}`,
          )
          .join("\n"),
      };
    },
  };

  const pay_: OpenClawPluginCommandDefinition = {
    name: "pay",
    description:
      "Pay each address the same amount: `/pay <amountEach> <addr1> <addr2> ... [--token addr|symbol] [--agent id] [--dry-run] [--confirm]` (defaults to USDC)",
    acceptsArgs: true,
    handler: async (ctx) => {
      try {
        const tokens = (ctx.args ?? "").trim().split(/\s+/).filter(Boolean);
        let agentId: string | undefined;
        let token: string | undefined;
        let dryRun = false;
        let confirm = false;
        const positional: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
          const t = tokens[i];
          if (t === "--dry-run") dryRun = true;
          else if (t === "--confirm") confirm = true;
          else if (t === "--agent") agentId = tokens[++i];
          else if (t === "--token") token = tokens[++i];
          else if (t !== undefined) positional.push(t);
        }
        const [amount, ...recipients] = positional;
        if (!amount || recipients.length === 0) {
          return { isError: true, text: "Usage: /pay <amountEach> <addr1> [addr2 ...] [--token addr|symbol] [--agent id] [--dry-run] [--confirm]" };
        }
        const req: PayoutRequest = {
          network,
          wallet,
          recipients,
          amount,
          ...(token ? { token } : {}),
          ...(agentId ? { agentId } : {}),
          ...gaslessFields(config),
        };
        if (dryRun) {
          const plan = await planBatchPayout(req, { budgetStore: budgets });
          const s = summarizePlan(plan);
          return {
            text: `DRY RUN (${s.method}${s.gasless ? ", gasless" : ""}): ${s.payout} ${s.token} (+${s.fee} fee) = ${s.totalCost} to ${s.recipientCount}. needsApproval=${s.needsApproval}, balanceOk=${s.balanceOk}`,
          };
        }
        const res = await executeBatchPayout(req, { budgetStore: budgets, confirmMainnet: confirm });
        return { text: `Paid ${res.plan.totalCostFormatted} ${res.plan.token} → ${res.explorer}` };
      } catch (e) {
        if (e instanceof RequiresMainnetConfirmationError) {
          return { isError: true, text: `${msg(e)} Add --confirm to send on mainnet.` };
        }
        return { isError: true, text: `Payout error: ${msg(e)}` };
      }
    },
  };

  return [wallet_, balance_, budget_, receipts_, pay_];
}

const plugin: OpenClawPluginDefinition = {
  id: "spraay-batch",
  name: "SpraayBatch",
  version: VERSION,
  description:
    "Agent-native, gasless batch ERC-20 payments on Base (any token; defaults to USDC).",

  register(api: OpenClawPluginApi) {
    try {
      const config = ensureConfig(readOverrides(api));

      let wallet: WalletInfo;
      try {
        wallet = resolveWallet(api.pluginConfig?.walletKey as string | undefined);
      } catch (e) {
        if (e instanceof WalletFileError) {
          api.logger.error(`SpraayBatch: ${e.message}`);
          return;
        }
        throw e;
      }

      const budgets = new BudgetStore();

      // First run: a key was just minted and is the only copy. Warn loudly — a user
      // who never sees this can fund an address whose key they have not backed up.
      if (wallet.source === "generated") {
        api.logger.warn(
          `SpraayBatch: NEW WALLET CREATED — ${wallet.address}. A private key was auto-generated ` +
            `and saved to ${SESSION_FILE} (0600, owner-only). This is the ONLY copy and nobody can ` +
            `recover it for you: if that file is lost, any funds it holds are lost with it. Back it ` +
            `up now with \`spraay-batch export-key\` and store the output somewhere safe (e.g. a ` +
            `password manager). Never share or commit the key.`,
        );
      }

      api.logger.info(`SpraayBatch ${VERSION} — ${describeWallet(wallet)}`);
      api.logger.info(
        `SpraayBatch: network=${config.network}, usdc=${networkInfo(config.network).usdc}, config=${CONFIG_FILE}`,
      );
      api.logger.info(
        `SpraayBatch: gasless=${
          gaslessActive(config)
            ? "ON (sponsored; fund the smart account — run spraay_wallet_info)"
            : "off (set a CDP paymaster URL to enable zero-ETH payouts)"
        }`,
      );

      for (const tool of buildTools(wallet, config, budgets)) api.registerTool(tool);
      for (const cmd of buildCommands(wallet, config, budgets)) api.registerCommand(cmd);
    } catch (e) {
      api.logger.error(`SpraayBatch failed to initialize: ${msg(e)}`);
    }
  },
};

export default plugin;

// Re-exports for hosts and tests.
export { SESSION_FILE, CONFIG_FILE } from "./paths.js";
export { resolveWallet, describeWallet } from "./wallet.js";
export { loadConfig, ensureConfig } from "./config.js";
export { planBatchPayout, executeBatchPayout } from "./payout.js";
export { BudgetStore } from "./budgets.js";
export { gaslessActive, getSmartAccountAddress, evaluateSponsorship, paymasterUrl } from "./gasless.js";
export { VERSION } from "./version.js";
export type { SpraayNetwork } from "./config.js";

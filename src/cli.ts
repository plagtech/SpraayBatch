#!/usr/bin/env node
/**
 * SpraayBatch CLI — standalone (works without OpenClaw installed).
 *
 *   spraay-batch [info]                      wallet address, network, file locations
 *   spraay-batch balance                     live USDC balance
 *   spraay-batch budget set <id> <usdc>      set a per-agent cap
 *   spraay-batch budget clear <id>           remove a cap
 *   spraay-batch budget status [id]          show cap(s)
 *   spraay-batch pay <amountEach> <addr...>  pay each address the same amount
 *                 [--agent id] [--dry-run] [--confirm]
 *   spraay-batch receipts [limit]            recent payments
 *   spraay-batch export-key                  print the private key for backup
 *   spraay-batch --help
 */

import { resolveWallet, exportPrivateKey, WalletFileError } from "./wallet.js";
import { ensureConfig, loadConfig } from "./config.js";
import { CONFIG_FILE, SESSION_FILE } from "./paths.js";
import { VERSION } from "./version.js";
import { addressUrl, getPublicClient, networkInfo } from "./chains.js";
import { getBalance } from "./usdc.js";
import { parseUsdc } from "./amounts.js";
import { gaslessActive, paymasterUrl, getSmartAccountAddress } from "./gasless.js";
import type { SpraayConfig } from "./config.js";
import type { WalletInfo } from "./wallet.js";
import { BudgetStore } from "./budgets.js";
import { readReceipts } from "./ledger.js";
import {
  planBatchPayout,
  executeBatchPayout,
  RequiresMainnetConfirmationError,
  type PayoutRequest,
} from "./payout.js";

const out = (s: string) => process.stdout.write(s + "\n");
const err = (s: string) => process.stderr.write(s + "\n");
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function usage(): void {
  out(
    [
      `SpraayBatch ${VERSION} — agent-native gasless USDC payments on Base`,
      "",
      "Usage:",
      "  spraay-batch [info]                      Wallet address, network, file locations",
      "  spraay-batch balance                     Live USDC balance",
      "  spraay-batch budget set <id> <usdc>      Set a per-agent spend cap",
      "  spraay-batch budget clear <id>           Remove a cap",
      "  spraay-batch budget status [id]          Show cap(s)",
      "  spraay-batch pay <amountEach> <addr...>  Pay each address the same amount",
      "                [--agent id] [--dry-run] [--confirm]",
      "  spraay-batch receipts [limit]            Recent payments",
      "  spraay-batch export-key                  Print the private key for backup",
      "  spraay-batch --help",
    ].join("\n"),
  );
}

function fundingAddress(config: SpraayConfig, wallet: WalletInfo): Promise<`0x${string}`> {
  return gaslessActive(config)
    ? getSmartAccountAddress(config.network, wallet)
    : Promise.resolve(wallet.address);
}

function gaslessFields(config: SpraayConfig): Pick<PayoutRequest, "gasless" | "paymasterUrl"> {
  return gaslessActive(config)
    ? { gasless: true, paymasterUrl: paymasterUrl(config) as string }
    : {};
}

async function info(): Promise<void> {
  const config = ensureConfig();
  const wallet = resolveWallet();
  const gasless = gaslessActive(config);
  const funding = await fundingAddress(config, wallet);
  out(
    [
      `Funding : ${funding}${gasless ? "  (smart account)" : ""}`,
      `Owner   : ${wallet.address}  (signer, source: ${wallet.source})`,
      `Network : ${config.network}`,
      `USDC    : ${networkInfo(config.network).usdc}`,
      `Explorer: ${addressUrl(config.network, funding)}`,
      `Gasless : ${gasless ? "on — zero ETH needed" : "off (set a CDP paymaster URL)"}`,
      `Key file: ${SESSION_FILE}`,
      `Config  : ${CONFIG_FILE}`,
      "",
      "Fund the funding address with USDC on the active network to start paying.",
    ].join("\n"),
  );
}

async function balance(): Promise<void> {
  const config = loadConfig();
  const wallet = resolveWallet();
  const funding = await fundingAddress(config, wallet);
  const bal = await getBalance(getPublicClient(config.network), config.network, funding);
  out(`Balance: ${bal.formatted} ${bal.symbol} on ${config.network} (${funding})`);
}

function budget(args: string[]): void {
  const store = new BudgetStore();
  const [sub, a, b] = args;
  if (sub === "set" && a && b) {
    store.setLimit(a, parseUsdc(b));
    out(`Cap for "${a}" set to ${b} USDC.`);
    return;
  }
  if (sub === "clear" && a) {
    store.setLimit(a, null);
    out(`Cap for "${a}" cleared.`);
    return;
  }
  if (sub === "status" || sub === undefined) {
    const rows = a ? [store.status(a)] : store.list();
    if (rows.length === 0) {
      out("No budgets set.");
      return;
    }
    for (const s of rows) {
      out(
        `${s.agentId}: spent ${s.spentFormatted}${
          s.limitFormatted ? ` / ${s.limitFormatted}` : " (uncapped)"
        }${s.remainingFormatted ? ` — ${s.remainingFormatted} left` : ""}`,
      );
    }
    return;
  }
  err("Usage: spraay-batch budget set <id> <usdc> | clear <id> | status [id]");
  process.exitCode = 1;
}

async function pay(args: string[]): Promise<void> {
  let agentId: string | undefined;
  let dryRun = false;
  let confirm = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === "--dry-run") dryRun = true;
    else if (t === "--confirm") confirm = true;
    else if (t === "--agent") agentId = args[++i];
    else if (t !== undefined) positional.push(t);
  }
  const [amount, ...recipients] = positional;
  if (!amount || recipients.length === 0) {
    err("Usage: spraay-batch pay <amountEach> <addr1> [addr2 ...] [--agent id] [--dry-run] [--confirm]");
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const wallet = resolveWallet();
  const req: PayoutRequest = {
    network: config.network,
    wallet,
    recipients,
    amount,
    ...(agentId ? { agentId } : {}),
    ...gaslessFields(config),
  };
  if (dryRun) {
    const plan = await planBatchPayout(req);
    out(
      `DRY RUN (${plan.method}): ${plan.payoutFormatted} USDC (+${plan.feeFormatted} fee) = ` +
        `${plan.totalCostFormatted} to ${plan.recipientCount}. ` +
        `needsApproval=${plan.needsApproval}, balanceOk=${plan.balanceOk}, paused=${plan.paused}`,
    );
    return;
  }
  const res = await executeBatchPayout(req, { confirmMainnet: confirm });
  out(`Paid ${res.plan.totalCostFormatted} USDC → ${res.explorer}`);
}

function receipts(args: string[]): void {
  const n = parseInt(args[0] ?? "", 10);
  const rows = readReceipts(Number.isFinite(n) && n > 0 ? n : 10);
  if (rows.length === 0) {
    out("No payments yet.");
    return;
  }
  for (const r of rows) {
    out(`${r.timestamp} — ${r.method} ${r.payout} USDC (+${r.fee} fee) to ${r.recipientCount} → ${r.explorer}`);
  }
}

function exportKey(): void {
  // Intentional, user-invoked disclosure for backup — the ONLY place the key is shown.
  const key = exportPrivateKey();
  err(
    "WARNING: this is your private key. Anyone with it controls your funds.\n" +
      "Store it offline; never paste it into a chat, issue, or commit.\n",
  );
  out(key);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case undefined:
    case "info":
    case "wallet":
      await info();
      return;
    case "balance":
      await balance();
      return;
    case "budget":
      budget(rest);
      return;
    case "pay":
      await pay(rest);
      return;
    case "receipts":
      receipts(rest);
      return;
    case "export-key":
    case "export":
      exportKey();
      return;
    case "-h":
    case "--help":
    case "help":
      usage();
      return;
    default:
      err(`Unknown command: ${cmd}\n`);
      usage();
      process.exitCode = 1;
  }
}

main().catch((e) => {
  if (e instanceof RequiresMainnetConfirmationError) {
    err(`${msg(e)} Add --confirm to send on mainnet.`);
  } else if (e instanceof WalletFileError) {
    err(msg(e));
  } else {
    err(`Error: ${msg(e)}`);
  }
  process.exitCode = 1;
});

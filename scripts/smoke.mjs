#!/usr/bin/env node
/**
 * SpraayBatch smoke test — exercises the real flow end-to-end against a live network.
 *
 *   node scripts/smoke.mjs                 # Base Sepolia (testnet, default)
 *   SMOKE_NETWORK=base SMOKE_CONFIRM=1 node scripts/smoke.mjs   # mainnet (explicit)
 *
 * Checks: (1) wallet resolution, (2) USDC balance + payout plan, (3) budget
 * enforcement, (4) a real batch payout (sprayEqual to self, so USDC round-trips).
 *
 * Requires `npm run build` first (imports from ../dist). Mainnet requires
 * SMOKE_CONFIRM=1 and spends real funds — testnet is the default.
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveWallet,
  planBatchPayout,
  executeBatchPayout,
  BudgetStore,
  loadConfig,
  gaslessActive,
  paymasterUrl,
} from "../dist/index.js";

const NETWORK = process.env.SMOKE_NETWORK ?? "base-sepolia";
const AMOUNT = process.env.SMOKE_AMOUNT ?? "0.01";
const isMainnet = NETWORK === "base";
const confirmMainnet = process.env.SMOKE_CONFIRM === "1";

// Reliable public RPCs (override the viem defaults, which rate-limit).
process.env.SPRAAY_BASE_SEPOLIA_RPC_URL ??= "https://base-sepolia-rpc.publicnode.com";
process.env.SPRAAY_BASE_RPC_URL ??= "https://base-rpc.publicnode.com";

const ok = (m) => console.log(`  ✓ ${m}`);
const step = (m) => console.log(`\n→ ${m}`);
let failures = 0;
const fail = (m) => {
  failures++;
  console.error(`  ✗ ${m}`);
};

console.log(`SpraayBatch smoke test on ${NETWORK}\n${"=".repeat(40)}`);

// 0) Mode: gasless (sponsored) when a paymaster URL is configured -------------
const config = loadConfig();
const gasless = gaslessActive(config);
const gaslessFields = gasless ? { gasless: true, paymasterUrl: paymasterUrl(config) } : {};
console.log(`Mode: ${gasless ? "GASLESS (CDP Paymaster / smart account)" : "EOA (self-paid gas)"}`);

// 1) Wallet resolution / creation --------------------------------------------
step("Wallet");
const wallet = resolveWallet();
if (/^0x[0-9a-fA-F]{40}$/.test(wallet.address)) ok(`address ${wallet.address} (source: ${wallet.source})`);
else fail(`invalid address: ${wallet.address}`);

// 2) Balance + payout plan ----------------------------------------------------
step("Balance + plan (read-only)");
const recipients = [wallet.address, wallet.address]; // pay the EOA (owner)
const plan = await planBatchPayout({ network: NETWORK, wallet, recipients, amount: AMOUNT, ...gaslessFields });
ok(`payer: ${plan.payer}${plan.gasless ? " (smart account, sponsored)" : ""}`);
ok(`USDC balance: ${(Number(plan.balance) / 10 ** plan.decimals).toString()}`);
ok(`plan: ${plan.method}, payout ${plan.payoutFormatted} + fee ${plan.feeFormatted} = ${plan.totalCostFormatted}`);
ok(`contract ${plan.sprayContract}, maxRecipients ${plan.maxRecipients}, paused ${plan.paused}`);
if (!plan.balanceOk) fail(`insufficient USDC: need ${plan.totalCostFormatted}, have ${plan.payoutFormatted === plan.totalCostFormatted ? "?" : ""}`);
else ok("balance covers payout + fee");

// 3) Budget enforcement (local) ----------------------------------------------
step("Budget enforcement");
const budgetFile = join(tmpdir(), `spraay-smoke-budget-${process.pid}.json`);
try {
  const budgets = new BudgetStore(budgetFile);
  budgets.setLimit("smoke-agent", plan.totalCost); // exactly enough for one payout
  const first = budgets.check("smoke-agent", plan.totalCost);
  if (first.allowed) ok("first payout allowed (within cap)");
  else fail("first payout should be allowed");
  budgets.record("smoke-agent", plan.totalCost);
  const second = budgets.check("smoke-agent", plan.totalCost);
  if (!second.allowed) ok(`second payout blocked once cap exhausted: ${second.reason}`);
  else fail("second payout should be blocked");
} finally {
  if (existsSync(budgetFile)) rmSync(budgetFile);
}

// 4) Real batch payout --------------------------------------------------------
step("Batch payout (LIVE)");
if (isMainnet && !confirmMainnet) {
  console.log("  ⚠ mainnet — skipping live send (set SMOKE_CONFIRM=1 to run)");
} else if (!plan.balanceOk) {
  fail("skipping live send — insufficient USDC");
} else {
  try {
    const res = await executeBatchPayout(
      { network: NETWORK, wallet, recipients, amount: AMOUNT, agentId: "smoke-agent", ...gaslessFields },
      { confirmMainnet },
    );
    ok(`sent ${res.plan.method} — ${res.plan.totalCostFormatted} USDC to ${res.plan.recipientCount}`);
    if (res.approvalTxHash) ok(`approval tx: ${res.approvalTxHash}`);
    ok(`payout tx: ${res.txHash}`);
    ok(`explorer: ${res.explorer}`);
  } catch (e) {
    fail(`live payout failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(`\n${"=".repeat(40)}`);
if (failures === 0) {
  console.log("SMOKE TEST PASSED");
  process.exit(0);
} else {
  console.error(`SMOKE TEST FAILED (${failures} failure(s))`);
  process.exit(1);
}

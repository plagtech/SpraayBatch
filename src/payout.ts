/**
 * Batch payout engine.
 *
 * "Pay N recipients" → one atomic tx via the Spray contract, signed and sent
 * LOCALLY with viem (non-custodial). Key correctness rules:
 *
 *  - The protocol fee is computed on-chain via `calculateTotalCost(payoutSum)`.
 *    The USDC approval and balance/budget checks use that FULL total (payout + fee),
 *    not the raw recipient sum — otherwise `transferFrom` reverts on a short allowance.
 *  - `sprayEqual` (same amount to all) is preferred whenever amounts are uniform —
 *    cheaper calldata — even if the caller supplied a per-recipient list.
 *    Otherwise `sprayToken` (per-recipient amounts) is used.
 *  - Mainnet sends require explicit confirmation; the engine refuses otherwise.
 *  - Contract `paused()` and `MAX_RECIPIENTS` are honored before spending gas.
 */

import type { PublicClient, WalletClient } from "viem";
import { SPRAY_ABI, ERC20_ABI } from "./abi.js";
import {
  getPublicClient,
  getWalletClient,
  networkInfo,
  requireSprayContract,
  txUrl,
} from "./chains.js";
import type { SpraayNetwork } from "./config.js";
import type { WalletInfo } from "./wallet.js";
import {
  allEqual,
  formatUsdc,
  parseAddresses,
  parseRecipients,
  parseUsdc,
  sum,
  USDC_DECIMALS,
} from "./amounts.js";
import { getAllowance, getBalance } from "./usdc.js";
import { appendLedger } from "./ledger.js";
import { BudgetStore, type BudgetCheck } from "./budgets.js";
import { getSmartAccountAddress, sendSponsoredCalls, type UserOpCall } from "./gasless.js";

export class RequiresMainnetConfirmationError extends Error {}
export class PayoutError extends Error {}

export interface PayoutRequest {
  network: SpraayNetwork;
  wallet: WalletInfo;
  recipients: string[];
  /** Per-recipient amounts (sprayToken). Mutually exclusive with `amount`. */
  amounts?: string[];
  /** Single amount paid to every recipient (sprayEqual). */
  amount?: string;
  /** Sub-agent this payout is billed to (for budget enforcement + ledger). */
  agentId?: string;
  /** Route via a sponsored ERC-4337 UserOp (smart account). Requires paymasterUrl. */
  gasless?: boolean;
  /** CDP Paymaster & Bundler URL; required when gasless is true. */
  paymasterUrl?: string;
}

interface ResolvedPayout {
  method: "sprayEqual" | "sprayToken";
  addresses: `0x${string}`[];
  amountsBase: bigint[];
  amountPerRecipient: bigint;
  payout: bigint;
}

/**
 * Pure mode-resolution + validation (no chain access): pick sprayEqual vs sprayToken
 * and parse/validate addresses and amounts. Exported for unit testing.
 */
export function resolvePayout(
  recipients: string[],
  amounts: string[] | undefined,
  amount: string | undefined,
  decimals: number = USDC_DECIMALS,
): ResolvedPayout {
  if (amount !== undefined && amounts !== undefined) {
    throw new PayoutError("Provide either `amount` (same to all) or `amounts` (per-recipient), not both.");
  }
  if (amount === undefined && amounts === undefined) {
    throw new PayoutError("Provide `amount` (same to all) or `amounts` (per-recipient).");
  }

  if (amount !== undefined) {
    const addresses = parseAddresses(recipients);
    const per = parseUsdc(amount, decimals);
    return {
      method: "sprayEqual",
      addresses,
      amountsBase: addresses.map(() => per),
      amountPerRecipient: per,
      payout: per * BigInt(addresses.length),
    };
  }

  const parsed = parseRecipients(recipients, amounts as string[], decimals);
  const addresses = parsed.map((p) => p.address);
  const amountsBase = parsed.map((p) => p.amount);
  // Uniform per-recipient amounts → still use the cheaper sprayEqual path.
  const uniform = allEqual(amountsBase);
  return {
    method: uniform ? "sprayEqual" : "sprayToken",
    addresses,
    amountsBase,
    amountPerRecipient: amountsBase[0] ?? 0n,
    payout: sum(amountsBase),
  };
}

export interface PayoutPlan extends ResolvedPayout {
  network: SpraayNetwork;
  token: "USDC";
  sprayContract: `0x${string}`;
  /** Address that funds the payout (smart account when gasless, else the EOA). */
  payer: `0x${string}`;
  /** Whether this payout will be sent as a sponsored UserOp. */
  gasless: boolean;
  recipientCount: number;
  decimals: number;
  fee: bigint;
  totalCost: bigint;
  payoutFormatted: string;
  feeFormatted: string;
  totalCostFormatted: string;
  balance: bigint;
  balanceOk: boolean;
  allowance: bigint;
  needsApproval: boolean;
  paused: boolean;
  maxRecipients: bigint;
  withinMax: boolean;
  budget: BudgetCheck;
}

export interface PayoutDeps {
  publicClient?: PublicClient;
  budgetStore?: BudgetStore;
}

/**
 * Build a full payout plan by reading the chain: fee (calculateTotalCost), balance,
 * allowance, paused, MAX_RECIPIENTS. Does not send anything.
 */
export async function planBatchPayout(
  req: PayoutRequest,
  deps: PayoutDeps = {},
): Promise<PayoutPlan> {
  const publicClient = deps.publicClient ?? getPublicClient(req.network);
  const sprayContract = requireSprayContract(req.network);
  const usdc = networkInfo(req.network).usdc;

  // When gasless, the payer (holds USDC, is msg.sender for the spray) is the smart
  // account, not the EOA. Balance/allowance are checked against the payer.
  const gasless = req.gasless === true && !!req.paymasterUrl;
  const payer = gasless
    ? await getSmartAccountAddress(req.network, req.wallet)
    : req.wallet.address;

  // USDC decimals drive amount parsing.
  const decimals = await publicClient
    .readContract({ address: usdc, abi: ERC20_ABI, functionName: "decimals" })
    .then((d) => Number(d))
    .catch(() => USDC_DECIMALS);

  const resolved = resolvePayout(req.recipients, req.amounts, req.amount, decimals);

  // Fee + full cost come from the contract; approval/balance/budget use totalCost.
  const [totalCost, paused, maxRecipients, allowance, balance] = await Promise.all([
    publicClient.readContract({
      address: sprayContract,
      abi: SPRAY_ABI,
      functionName: "calculateTotalCost",
      args: [resolved.payout],
    }),
    publicClient.readContract({ address: sprayContract, abi: SPRAY_ABI, functionName: "paused" }),
    publicClient.readContract({ address: sprayContract, abi: SPRAY_ABI, functionName: "MAX_RECIPIENTS" }),
    getAllowance(publicClient, req.network, payer, sprayContract),
    getBalance(publicClient, req.network, payer),
  ]);

  const fee = totalCost - resolved.payout;
  const budgetStore = deps.budgetStore ?? new BudgetStore();
  const budget = req.agentId
    ? budgetStore.check(req.agentId, totalCost)
    : { allowed: true, remaining: null };

  return {
    ...resolved,
    network: req.network,
    token: "USDC",
    sprayContract,
    payer,
    gasless,
    recipientCount: resolved.addresses.length,
    decimals,
    fee,
    totalCost,
    payoutFormatted: formatUsdc(resolved.payout, decimals),
    feeFormatted: formatUsdc(fee, decimals),
    totalCostFormatted: formatUsdc(totalCost, decimals),
    balance: balance.raw,
    balanceOk: balance.raw >= totalCost,
    allowance,
    needsApproval: allowance < totalCost,
    paused,
    maxRecipients,
    withinMax: BigInt(resolved.addresses.length) <= maxRecipients,
    budget,
  };
}

/** Build the spray call (sprayEqual or sprayToken) as an ERC-4337 UserOp call. */
function buildSprayCall(plan: PayoutPlan, usdc: `0x${string}`): UserOpCall {
  if (plan.method === "sprayEqual") {
    return {
      to: plan.sprayContract,
      abi: SPRAY_ABI,
      functionName: "sprayEqual",
      args: [usdc, plan.addresses, plan.amountPerRecipient],
    };
  }
  const tuples = plan.addresses.map((address, i) => ({
    recipient: address,
    amount: plan.amountsBase[i] ?? 0n,
  }));
  return { to: plan.sprayContract, abi: SPRAY_ABI, functionName: "sprayToken", args: [usdc, tuples] };
}

export interface PayoutResult {
  plan: PayoutPlan;
  approvalTxHash?: `0x${string}`;
  txHash: `0x${string}`;
  explorer: string;
}

export interface ExecuteOptions extends PayoutDeps {
  /** Required to send on Base mainnet; ignored on testnet. */
  confirmMainnet?: boolean;
  walletClient?: WalletClient;
}

/**
 * Execute a batch payout: approve (if needed) then spray, recording the ledger and
 * budget. Enforces all guards before spending gas.
 */
export async function executeBatchPayout(
  req: PayoutRequest,
  opts: ExecuteOptions = {},
): Promise<PayoutResult> {
  const publicClient = opts.publicClient ?? getPublicClient(req.network);
  const budgetStore = opts.budgetStore ?? new BudgetStore();

  const plan = await planBatchPayout(req, { publicClient, budgetStore });

  // --- Guards (fail before spending gas) ---
  if (plan.paused) {
    throw new PayoutError("The Spray contract is paused; batch payouts are temporarily disabled.");
  }
  if (!plan.withinMax) {
    throw new PayoutError(
      `Too many recipients: ${plan.recipientCount} > MAX_RECIPIENTS (${plan.maxRecipients}).`,
    );
  }
  if (!plan.budget.allowed) {
    throw new PayoutError(plan.budget.reason ?? "Budget exceeded.");
  }
  if (!plan.balanceOk) {
    throw new PayoutError(
      `Insufficient USDC: need ${plan.totalCostFormatted} (payout + fee) but balance is ${formatUsdc(
        plan.balance,
        plan.decimals,
      )}. Fund ${plan.payer}${plan.gasless ? " (smart account)" : ""}.`,
    );
  }
  if (req.network === "base" && !opts.confirmMainnet) {
    throw new RequiresMainnetConfirmationError(
      `Mainnet payout of ${plan.totalCostFormatted} USDC to ${plan.recipientCount} recipient(s) ` +
        `requires explicit confirmation. Re-run with confirmation to proceed.`,
    );
  }

  const usdc = networkInfo(req.network).usdc;
  const sprayCall = buildSprayCall(plan, usdc);

  let approvalTxHash: `0x${string}` | undefined;
  let txHash: `0x${string}`;

  if (plan.gasless) {
    // --- Sponsored path: approve (if needed) + spray, atomically batched in one UserOp ---
    const calls: UserOpCall[] = [];
    if (plan.needsApproval) {
      calls.push({
        to: usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [plan.sprayContract, plan.totalCost],
      });
    }
    calls.push(sprayCall);
    txHash = await sendSponsoredCalls(req.network, req.wallet, req.paymasterUrl as string, calls);
  } else {
    // --- EOA path: approve (separate tx) then spray, both paid in ETH ---
    const walletClient = opts.walletClient ?? getWalletClient(req.network, req.wallet);
    const account = walletClient.account;
    if (!account) throw new PayoutError("Wallet client has no account.");

    if (plan.needsApproval) {
      const { request } = await publicClient.simulateContract({
        account,
        address: usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [plan.sprayContract, plan.totalCost],
      });
      approvalTxHash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash: approvalTxHash });
    }

    if (plan.method === "sprayEqual") {
      const { request } = await publicClient.simulateContract({
        account,
        address: plan.sprayContract,
        abi: SPRAY_ABI,
        functionName: "sprayEqual",
        args: [usdc, plan.addresses, plan.amountPerRecipient],
      });
      txHash = await walletClient.writeContract(request);
    } else {
      const tuples = plan.addresses.map((address, i) => ({
        recipient: address,
        amount: plan.amountsBase[i] ?? 0n,
      }));
      const { request } = await publicClient.simulateContract({
        account,
        address: plan.sprayContract,
        abi: SPRAY_ABI,
        functionName: "sprayToken",
        args: [usdc, tuples],
      });
      txHash = await walletClient.writeContract(request);
    }
    await publicClient.waitForTransactionReceipt({ hash: txHash });
  }

  // --- Record ledger + budget ---
  const explorer = txUrl(req.network, txHash);
  appendLedger({
    timestamp: new Date().toISOString(),
    network: req.network,
    type: "batch",
    method: plan.method,
    token: "USDC",
    recipientCount: plan.recipientCount,
    recipients: plan.addresses,
    amounts: plan.amountsBase.map((a) => formatUsdc(a, plan.decimals)),
    payout: plan.payoutFormatted,
    fee: plan.feeFormatted,
    totalCost: plan.totalCostFormatted,
    txHash,
    explorer,
    ...(req.agentId ? { agentId: req.agentId } : {}),
  });
  if (req.agentId) budgetStore.record(req.agentId, plan.totalCost);

  return { plan, approvalTxHash, txHash, explorer };
}

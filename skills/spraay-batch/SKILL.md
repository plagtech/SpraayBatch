---
name: spraay-batch
description: >-
  Send batch ERC-20 payments on Base from an OpenClaw agent — any token,
  defaults to USDC. Check the wallet balance, set per-agent budget caps, and pay
  one or many recipients in a single atomic batch. Non-custodial and gasless (the
  agent needs only the token it is paying, no ETH). Use when an agent must pay
  someone, run payroll, or manage a spend budget.
---

# SpraayBatch

SpraayBatch gives an agent its own non-custodial wallet and lets it pay **any ERC-20
on Base (defaults to USDC)**. Gas is sponsored, so the agent needs **only the token
it's paying — no ETH**.

## What you can do

- **Check the wallet** — get the funding address (to receive funds), the owner/signer
  address, the active network, and whether gasless is on.
  Tool: `spraay_wallet_info`. Slash-command: `/wallet`.
- **Check a balance** — live token balance of the funding address. Defaults to USDC;
  pass a `token` (0x address or a known symbol like WETH, DAI, cbBTC, EURC) for any ERC-20.
  Tool: `spraay_balance`. Slash-command: `/balance [token]`.
- **Budgets** — a parent agent caps how much each sub-agent may spend, in USDC;
  spending is blocked once a cap is hit. Tools: `spraay_budget_set` (set or clear a
  cap), `spraay_budget_status` (limit / spent / remaining, per agent or all).
  Slash-command: `/budget set <agentId> <usdc> | clear <agentId> | status [agentId]`.
- **Batch payout** — pay N recipients in one atomic transaction. Pass `amount` to send
  everyone the same amount (cheaper calldata), or `amounts` for per-recipient amounts.
  Use `dry_run: true` to preview method, fee, and total cost without sending.
  Tool: `spraay_batch_pay`. Slash-command:
  `/pay <amountEach> <addr1> [addr2 ...] [--token addr|symbol] [--agent id] [--dry-run] [--confirm]`.
- **Receipts** — every payment is logged locally with its Basescan link; filter by
  token symbol. Tool: `spraay_receipts`. Slash-command: `/receipts [limit] [tokenSymbol]`.

## Fees and limits

- Base mainnet charges a **0.30% protocol fee on top of** the payout (a 1000-token batch
  costs a 3-token fee), so the sender must hold payout + fee. Base Sepolia is free.
  Run a `dry_run` to see the exact fee first.
- Recipients per batch are capped by the contract's `MAX_RECIPIENTS`, checked before
  signing. Fee-on-transfer and rebasing tokens are rejected.

## Safety

- The private key never leaves the machine and is never logged. Back it up with
  `spraay-batch export-key`.
- Payments are signed locally, not through any gateway.
- Mainnet sends require explicit confirmation (`confirm_mainnet: true` on the tool,
  `--confirm` on `/pay`); testnet (Base Sepolia) is the default network.
- Amounts, addresses, budget, balance, and contract pause state are all validated
  before anything is signed.

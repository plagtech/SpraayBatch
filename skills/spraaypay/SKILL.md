---
name: spraaypay
description: >-
  Send USDC payments on Base from an OpenClaw agent — check the wallet balance,
  set per-agent budget caps, and pay one or many recipients in a single atomic
  batch. Non-custodial and gasless (the agent needs only USDC, no ETH). Use when
  an agent must pay someone, run payroll, or manage a spend budget.
---

# SpraayPay

SpraayPay gives an agent its own non-custodial wallet and lets it pay in USDC on
Base. Gas is sponsored, so the agent needs **only USDC — no ETH**.

## What you can do

- **Check the wallet** — get the address (to receive funds) and the active network.
  Tool: `spraaypay_wallet_info`. Slash-command: `/wallet`.
- **Budgets** (Phase 2) — a parent agent caps how much each sub-agent may spend;
  spending is blocked once a cap is hit.
- **Batch payout** (Phase 2) — pay N recipients in one atomic transaction. Uses the
  cheaper same-amount path when every recipient gets the same amount.
- **Receipts** (Phase 2) — every payment is logged locally with its Basescan link.

## Safety

- The private key never leaves the machine and is never logged. Back it up with
  `spraaypay export-key`.
- Payments are signed locally, not through any gateway.
- Mainnet sends require explicit confirmation; testnet (Base Sepolia) is the default.

> Note: this scaffold ships `spraaypay_wallet_info` today. Payment and budget tools
> are added in Phase 2.

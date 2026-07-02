We're building SpraayPay — an OpenClaw plugin that becomes the agent's
default payment/treasury layer. Think ClawRouter, but for money-out
instead of model routing. Work in phases and stop for my approval
after each phase.

PHASE 0 — RESEARCH (no code yet)
1. Clone https://github.com/BlockRunAI/ClawRouter (MIT) into ./reference/
2. Study and report back on:
   - How it registers as an OpenClaw plugin (manifest, entry points,
     gateway hooks)
   - How its install script works (curl one-liner → registration →
     config → restart)
   - How its local proxy handles x402 payment signing
   - How wallet creation/storage works
3. Also review my existing MCP repo at
   https://github.com/plagtech/spraay-x402-mcp — we will PORT its
   auto-wallet creation (~/.spraay/.session, no private key required)
   rather than rewrite it.
4. Give me a short written plan for how our plugin will hook into
   OpenClaw before writing any code. Do NOT copy ClawRouter's routing
   logic — we only want the integration pattern.

PHASE 1 — SCAFFOLD
- New repo: spraaypay (TypeScript, ESM, matching my gateway's stack)
- Plugin registration + install script (one-liner like ClawRouter's)
- Auto-create EVM wallet on first run (port from spraay-x402-mcp)
- Config file at ~/.spraay/spraaypay.json

PHASE 2 — CORE FEATURES (v0.1 scope, nothing more)
1. WALLET: balance check (USDC on Base), funding instructions,
   non-custodial — key never leaves machine
2. BUDGETS: parent agent sets spend caps per sub-agent (agent_id →
   limit), auto-block when exhausted, persisted locally
3. BATCH PAYOUT: command "pay N recipients" → one atomic tx via my
   batch contract on Base:
   0x1646452F98E36A3c9Cfc3eDD8868221E207B5eEC
   USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
   Use viem v2. Validate addresses + amounts before signing.
4. LEDGER: append-only local log of every payment (timestamp,
   recipient(s), amount, tx hash, Basescan link), plus a "receipts"
   command that prints recent spend

PHASE 3 — GASLESS (the hook)
- Coinbase Paymaster (CDP) gas sponsorship so agents holding only
  USDC can transact with zero ETH. I have existing Paymaster
  integration in plagtech/mangoswap to reference.
- Sponsored on free tier; design so I can cap sponsorship later.

PHASE 4 — POLISH
- README with: one-line install at top, animated demo placeholder,
  and a comparison table (SpraayPay vs manual sends vs multisig vs
  payroll SaaS — rows: gasless, batch, budget caps, non-custodial,
  agent-native)
- MIT license
- Smoke tests for wallet creation, budget enforcement, batch payout
  (Base Sepolia first, then mainnet)

RULES
- Never log or transmit private keys
- Show me diffs before applying edits
- I handle npm publish manually (2FA)
- Run tsc clean before each commit
- Stop and ask me before ANY mainnet transaction
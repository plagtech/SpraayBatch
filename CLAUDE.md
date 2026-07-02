# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Status: Phases 0–4 complete and PUBLISHED as `spraay-batch@0.2.0`.** Research, scaffold,
> core features, gasless (CDP Paymaster / ERC-4337), and polish (README, MIT LICENSE, smoke
> tests) are done. tsc/eslint clean, 20 unit tests pass. **A real batch payout has been executed
> end-to-end on Base Sepolia** (`npm run smoke`): approval + `sprayEqual` to two recipients,
> budget enforced, ledger recorded (tx `0xaac7cafb…`). **Live *gasless* send also verified on
> Base Sepolia**: a sponsored `approve`+`sprayEqual` UserOp from the smart account `0xD30B…`
> (tx `0xcaead8cc…`) — smart account paid **0 ETH** (fully sponsored by the CDP Paymaster), USDC
> debited correctly, account auto-deployed via initCode. Requires USDC **and** the Spray contract
> to be allowlisted in the CDP paymaster policy.
>
> **RENAMED 2026-07-02: SpraayPay → SpraayBatch (v0.1 → v0.2.0).** npm package `spraaypay` →
> **`spraay-batch`** (published, `latest` = 0.2.0); the old **`spraaypay@0.1.0` is DEPRECATED** on
> npm ("Renamed to spraay-batch — please install spraay-batch instead"). GitHub repo →
> **`plagtech/SpraayBatch`**. Agent tool IDs `spraaypay_*` → **`spraay_*`** (`spraay_wallet_info`,
> `spraay_balance`, `spraay_budget_set`, `spraay_budget_status`, `spraay_batch_pay`,
> `spraay_receipts`). CLI bin → **`spraay-batch`**; config file → **`~/.spraay/spraay-batch.json`**.
> UNCHANGED by the rename (deliberate): the `~/.spraay/` dir, `.session` path, `SPRAAY_*` env vars,
> and all deployed contract addresses.
>
> **TODO before a MAINNET (`base`) gasless launch:** (1) **Allowlist** the mainnet Spray contract
> `0x1646452F98E36A3c9Cfc3eDD8868221E207B5eEC` **and** mainnet USDC
> `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` in the CDP paymaster policy (both the `approve` and
> the spray calls are sponsored). (2) **Sponsorship caps** — enforce `sponsorship.capUsd` locally
> via `evaluateSponsorship()` (currently a hook only; the authoritative cap is the CDP dashboard
> policy). (3) **Dust limits** — add a minimum per-recipient amount so tiny/zero payouts can't
> burn sponsored gas on economically pointless transfers.
>
> **OpenClaw is NOT installed on this machine.** Target the **current stable OpenClaw release**
> (integration surface documented in `./reference/ClawRouter`). Build the plugin so it can be
> installed and exercised once OpenClaw is present; Claude installs OpenClaw itself at the
> smoke-test phase.
>
> **Base Sepolia Spray contract: DEPLOYED.** `0xfb1B884E489B0296CefadA2d8Db7CFbD1ED62f7A`
> (0 fee bps, feeRecipient = session wallet), wired into `src/chains.ts`. Deployed from the
> Hardhat project at `C:\Users\dell\Documents\spray-app\contracts` using the SpraayBatch session
> key (not the project `.env`). The session wallet also holds ~21 test USDC on Base Sepolia, so
> a live testnet batch-payout smoke test is possible in Phase 4.

## What SpraayBatch is

SpraayBatch is an **OpenClaw plugin** that becomes the agent's default **payment / treasury
layer** — "ClawRouter, but for money-out instead of model routing." An autonomous agent
(and its sub-agents) can hold and spend **USDC on Base**, non-custodially, with gas sponsored
so the agent needs **zero ETH**.

- Stack: **TypeScript, ESM** (matches the user's OpenClaw gateway stack).
- Distribution: npm package + **one-line install script** (curl one-liner → register plugin →
  write config → restart), modeled on ClawRouter's installer.
- Runtime data lives under **`~/.spraay/`** (config: `~/.spraay/spraay-batch.json`; wallet
  session: `~/.spraay/.session`).

## Build phases (build in order; STOP for user approval after each phase)

- **Phase 0 — Research (no code):** Clone ClawRouter into `./reference/`, study its OpenClaw
  plugin registration, install script, x402 payment signing proxy, and wallet storage. Review
  `plagtech/spraay-x402-mcp` (we will **port**, not rewrite, its auto-wallet creation). Deliver
  a short written integration plan before any code. **Do NOT copy ClawRouter's routing logic —
  only its integration pattern.**
- **Phase 1 — Scaffold:** New TS/ESM repo; plugin registration + one-liner install script;
  auto-create EVM wallet on first run (ported from `spraay-x402-mcp`); config at
  `~/.spraay/spraay-batch.json`.
- **Phase 2 — Core features (v0.1 scope only, nothing more):**
  - **Wallet** — USDC balance check on Base, funding instructions; non-custodial, key never
    leaves the machine. Ships an **`export-key`** command so users can back up the auto-created
    key. (Recoverable BIP-39 mnemonic wallets are a **v0.2** upgrade — v0.1 uses the single-key
    `~/.spraay/.session` model for consistency with `spraay-x402-mcp`.)
  - **Budgets** — parent agent sets spend caps per sub-agent (`agent_id → limit`); auto-block
    when exhausted; persisted locally.
  - **Batch payout** — "pay N recipients" → one atomic tx via the batch contract, signed and
    sent **locally with viem `writeContract`** (never routed through the gateway — local,
    non-custodial signing is the point). Pick the cheapest call: `sprayEqual` when every
    recipient gets the same amount, `sprayToken` for varying amounts. ERC-20 `approve` (or
    allowance check) must precede the spray call. **Validate all addresses and amounts, and
    confirm against `MAX_RECIPIENTS`, before signing.**
  - **Ledger** — append-only local log of every payment (timestamp, recipient(s), amount, tx
    hash, Basescan link) + a `receipts` command that prints recent spend.
- **Phase 3 — Gasless:** Coinbase **CDP Paymaster** gas sponsorship (agents with only USDC,
  zero ETH). Reference `plagtech/mangoswap`. Sponsored on free tier; **design so sponsorship
  can be capped later** without a rewrite.
- **Phase 4 — Polish:** README (one-line install at top, animated demo placeholder, comparison
  table: SpraayBatch vs manual sends vs multisig vs payroll SaaS — rows: gasless, batch, budget
  caps, non-custodial, agent-native); MIT license; smoke tests for wallet creation, budget
  enforcement, batch payout (**Base Sepolia first, then mainnet**).

## On-chain constants

**Base mainnet:**
- **Spray (batch payout) contract:** `0x1646452F98E36A3c9Cfc3eDD8868221E207B5eEC`
  (verified ABI at `reference/spray-contract-abi.json`, feeBps=30).
- **USDC:** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

**Base Sepolia (testnet):**
- **Spray contract:** `0xfb1B884E489B0296CefadA2d8Db7CFbD1ED62f7A` (deployed by SpraayBatch, feeBps=0).
- **USDC:** `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle official).

- **Chain client:** **viem v2**, signing locally.

### Spray contract surface (what the batch payout uses)

- `sprayToken(address token, Recipient[] recipients)` — ERC-20, **varying** amounts.
  `Recipient` is a `(address recipient, uint256 amount)` tuple. `nonpayable`.
- `sprayEqual(address token, address[] recipients, uint256 amountPerRecipient)` — **same**
  amount to everyone; cheaper calldata than the tuple form. Prefer it when amounts are uniform.
- `sprayETH(Recipient[] recipients)` — native ETH, varying amounts, `payable`.
- **Fees:** the contract charges `feeBps`; use `calculateFee(amount)` /
  `calculateTotalCost(totalAmount)` to size the payment and **record the fee in the ledger**.
- **Approval:** token sprays pull via SafeERC20 `transferFrom` — the sender must `approve` the
  contract for the total (amount + fee) first; check allowance and top up as needed.
- **Limits/guards:** respect `MAX_RECIPIENTS`; the contract is `Pausable` (`paused()`) — a
  batch will revert if paused, so surface that clearly rather than burning gas.

## External references

- **ClawRouter** — https://github.com/BlockRunAI/ClawRouter (MIT), cloned to `./reference/`.
  Integration pattern only; do not lift its routing logic.
- **`spraay-x402-mcp`** — source of the auto-wallet creation to port. **Not** cloned into
  `reference/`; read it locally at `C:\Users\dell\Documents\spraay-x402-mcp`
  (`src/wallet.ts` = `resolveWallet`/`logWallet`).
- **`reference/spray-contract-abi.json`** — verified Spray batch-payout contract ABI.
- **`plagtech/mangoswap`** — existing CDP Paymaster integration to reference for Phase 3.
- Note: the connected **`spraay` MCP server is NOT related** to this project — do not build on it.

## Architecture

SpraayBatch reuses ClawRouter's **integration skeleton** (see `./reference/ClawRouter`) but
**none of its routing/proxy/model logic** — SpraayBatch is money-out, not inference-routing.

### How it hooks into OpenClaw (pattern lifted from ClawRouter)

- **Manifest** `openclaw.plugin.json`: `id: spraay-batch`, `activation.onStartup`, `skills:
  ["./skills"]`, `configSchema` (optional `walletKey`, marked `sensitive`; sponsorship-cap
  setting), and `contracts.tools` listing the agent-callable payment tools.
- **`package.json`** `openclaw` field: `extensions: ["./dist/index.js"]` + `compat` targeting
  the current stable gateway; `peerDependencies.openclaw` (optional); `type: module`;
  `bin: spraay-batch` for the CLI.
- **`src/index.ts`** exports an `OpenClawPluginDefinition`; the loader calls `register()`
  (`activate` is an alias). On load it **idempotently**: ensures `~/.spraay/spraay-batch.json`,
  resolves/auto-creates the wallet, registers tools + slash-commands, and copies bundled
  `skills/` into `~/.openclaw/workspace/skills/`.
- **Install-time gotcha (must respect):** do **not** write OpenClaw's config file during
  `openclaw plugins install` — ClawRouter defers config writes to first gateway start because
  writing mid-install trips a config-hash check and rolls the install back. Use the same
  atomic write + defer-outside-gateway-mode guard, and back up (never clobber) a corrupt config.

### Command surface — expose all three (priority order)

1. **Agent tools** (`contracts.tools`) — *primary*; agents are the customer.
2. **Slash-commands** — for humans testing.
3. **Bundled skill** (`skills/`) — ships alongside, matching the ClawRouter pattern.

### Modules to build (Phase 1–2), and what to port

- **Wallet** — port `resolveWallet()`/`logWallet()` from
  `C:\Users\dell\Documents\spraay-x402-mcp\src\wallet.ts` (env `EVM_PRIVATE_KEY` →
  `~/.spraay/.session` `0600` → generate+persist; logs address only, never the key). Adopt
  ClawRouter's safety guard: **refuse to auto-generate** when the key file is present-but-
  corrupt, so a funded wallet is never silently replaced. Add `export-key`.
- **Budgets** — model on ClawRouter's `src/spend-control.ts` (`SpendControl`: limits, rolling
  windows, persisted `0600`, `check()`/`record()`), re-keyed by `agent_id → limit` with a hard
  block on exhaustion; persist under `~/.spraay/`.
- **Batch payout** — build/validate/sign/send via viem `writeContract` against the Spray
  contract (see "Spray contract surface" above); `sprayEqual` vs `sprayToken` chosen by whether
  amounts are uniform.
- **Ledger** — append-only local log (timestamp, recipients, amount, fee, tx hash, Basescan
  link) + a `receipts` command.

### `./reference/` is git-ignored and never shipped (dev-only mining ground).

## Hard rules (do not violate)

1. **Never log or transmit private keys** — anywhere, ever. Keys never leave the machine.
2. **Stop and ask before ANY mainnet transaction.** Base Sepolia (testnet) is fine to proceed on.
3. **Show diffs before applying edits.**
4. **Run `tsc` clean before each commit** — no type errors may be committed.
5. **The user publishes to npm manually** (2FA). Never run `npm publish`.
6. **Stop for approval at the end of each build phase.**

## Toolchain & commands

- **TypeScript, ESM, Node ≥ 22.** `tsc` must pass clean before every commit.
- `npm run build` — `tsup` → `dist/{index,cli}.{js,d.ts}`
- `npm run typecheck` — `tsc --noEmit` (src only)
- `npm run lint` — `eslint src/`  ·  `npm run format` — `prettier`
- `npm test` — `vitest run` (scoped to `test/` via `vitest.config.ts`; **never** runs the
  `reference/` clones). Run a single file: `npx vitest run test/payout.test.ts`.
- **Unit tests** cover pure logic (amounts, budgets, payout mode-resolution). **Smoke tests**
  (wallet creation, budget enforcement, batch payout) come in Phase 4 — Base Sepolia first.
- **License:** MIT.

## Module map (`src/`)

- `openclaw.ts` — duck-typed OpenClaw plugin API (optional peer dep, so no build-time import).
- `paths.ts` — `~/.spraay/` locations. `config.ts` — `spraay-batch.json` (atomic, 0600).
- `wallet.ts` — ported `resolveWallet` + corruption guard + `exportPrivateKey`.
- `abi.ts` — minimal `SPRAY_ABI` + `ERC20_ABI` (`as const`). `chains.ts` — networks, clients,
  `requireSprayContract`. `amounts.ts` — USDC parse/format + recipient validation (bigint base
  units). `usdc.ts` — balance/allowance reads.
- `budgets.ts` — `BudgetStore` (agent_id → cap, hard block, persisted). `ledger.ts` — append-only
  `ledger.jsonl` + `readReceipts`.
- `payout.ts` — `resolvePayout` (pure; picks sprayEqual vs sprayToken), `planBatchPayout`
  (read-only; payer = smart account when gasless, else EOA), `executeBatchPayout`
  (approve-to-totalCost → spray → ledger+budget; guards: paused, MAX_RECIPIENTS, budget,
  balance, mainnet-confirmation). Gasless path batches approve+spray into one sponsored UserOp.
- `gasless.ts` — CDP Paymaster / ERC-4337. `paymasterUrl` (env `CDP_PAYMASTER_URL` → config),
  `gaslessActive`, `getSmartAccount(Address)` (Coinbase Smart Account owned by the EOA),
  `sendSponsoredCalls` (batched UserOp via `createBundlerClient({paymaster:true})`),
  `evaluateSponsorship` (cap hook). Uses `viem/account-abstraction`.
- `index.ts` — plugin `register()` + 6 tools + 5 slash-commands. `cli.ts` — standalone CLI.

### Gasless (Phase 3) — key facts

- **Opt-in:** activates only when a CDP paymaster URL is set AND `sponsorship.enabled`. Default
  (no URL) keeps the Phase 2 EOA path (which needs ETH for gas).
- **Funding address changes when gasless:** the payer that holds USDC and is `msg.sender` for
  the spray becomes the **Coinbase Smart Account** (deterministic, owned by the EOA). The EOA
  only signs. `wallet_info`/`balance`/`/wallet` report the effective funding address.
- **Capping later:** authoritative cap is the CDP dashboard paymaster policy; `sponsorship.capUsd`
  + `evaluateSponsorship()` are the local hook for future client-side metering.

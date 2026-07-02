# SpraayPay

**Agent-native, gasless USDC payments on Base — for [OpenClaw](https://github.com/BlockRunAI/ClawRouter).**
An autonomous agent gets its own non-custodial wallet and can pay one or many recipients in a
single atomic transaction — holding **only USDC, zero ETH** (gas is sponsored via the Coinbase
CDP Paymaster). Set per-agent budget caps so a parent agent can bound what each sub-agent spends.

```bash
curl -fsSL https://spraay.app/spraaypay-install | bash
```

<!-- TODO: replace with the real animated walkthrough (docs/demo.gif) -->
![SpraayPay demo — animated walkthrough coming soon](docs/demo.gif)

> 🎬 _Demo GIF coming soon._

---

## Why SpraayPay

|                              | **SpraayPay** | Manual sends | Multisig (e.g. Safe) | Payroll SaaS |
| ---------------------------- | :-----------: | :----------: | :------------------: | :----------: |
| **Gasless** (zero-ETH sender) |  ✅ CDP Paymaster |      ❌       |          ❌          |  ⚠️ varies   |
| **Batch** (N recipients, 1 atomic tx) |      ✅       |   ❌ one-by-one   |      ⚠️ manual       |      ✅      |
| **Budget caps** (per agent)  |      ✅       |      ❌       |    ⚠️ policy module   |   ⚠️ seat-based |
| **Non-custodial** (key stays local) |      ✅       |      ✅       |          ✅          |  ❌ custodial |
| **Agent-native** (programmatic tools) |      ✅       |      ❌       |          ❌          |      ❌      |

## How it works

- **Non-custodial wallet.** On first run SpraayPay creates an EVM wallet at `~/.spraay/.session`
  (or reuses one). The private key never leaves your machine and is never logged.
- **Batch payout.** "Pay N recipients" becomes a single atomic transaction via the on-chain
  Spray contract — `sprayEqual` when everyone gets the same amount (cheaper), `sprayToken` for
  per-recipient amounts. The USDC approval is sized to `payout + protocol fee`, so it can't
  revert on a short allowance.
- **Gasless (opt-in).** Point SpraayPay at a Coinbase CDP Paymaster URL and the agent can pay
  with **zero ETH**: payouts run as sponsored ERC-4337 UserOperations from a Coinbase Smart
  Account owned by your key. When gasless is on, the address you fund with USDC is the smart
  account (shown by `spraaypay info`).
- **Budgets.** A parent agent caps each sub-agent (`agent_id → limit`); once the cap is hit,
  that agent's payouts are blocked. Caps and spend persist locally.
- **Ledger.** Every payment is appended to `~/.spraay/ledger.jsonl` with a Basescan link;
  `spraaypay receipts` prints recent spend.

## Quick start

```bash
curl -fsSL https://spraay.app/spraaypay-install | bash   # installs the OpenClaw plugin
spraaypay info                                            # show your wallet address + network
# → fund that address with USDC on Base (Base Sepolia by default)
```

Then, from your agent, call the `spraaypay_batch_pay` tool — or test by hand:

```bash
spraaypay pay 10 0xRecipientA 0xRecipientB --dry-run     # preview cost + fee, no send
spraaypay pay 10 0xRecipientA 0xRecipientB               # pay each 10 USDC in one tx
```

## Agent tools

Agents are the primary consumer. The plugin registers these tools (`contracts.tools`):

| Tool | What it does |
| --- | --- |
| `spraaypay_wallet_info` | Funding address, owner, network, gasless status, funding link |
| `spraaypay_balance` | Live USDC balance of the funding address |
| `spraaypay_budget_set` | Set/clear a sub-agent's spend cap (USDC) |
| `spraaypay_budget_status` | Cap / spent / remaining for one or all agents |
| `spraaypay_batch_pay` | Pay N recipients in one atomic tx (`amount` = same to all, or `amounts` = per-recipient); `dry_run`, `agent_id`, `confirm_mainnet` |
| `spraaypay_receipts` | Recent payments from the local ledger |

## Slash-commands (for humans testing)

`/wallet` · `/balance` · `/budget set <id> <usdc>` · `/receipts` · `/pay <amountEach> <addr…> [--agent id] [--dry-run] [--confirm]`

## CLI

```
spraaypay [info]                      Wallet address, network, file locations
spraaypay balance                     Live USDC balance
spraaypay budget set <id> <usdc>      Set a per-agent spend cap
spraaypay budget clear <id>           Remove a cap
spraaypay budget status [id]          Show cap(s)
spraaypay pay <amountEach> <addr...>  Pay each address the same amount [--agent id] [--dry-run] [--confirm]
spraaypay receipts [limit]            Recent payments
spraaypay export-key                  Print the private key for backup (keep it secret)
```

## Configuration

Config lives at `~/.spraay/spraaypay.json`. Via OpenClaw plugin config or these env vars:

| Setting | Env var | Notes |
| --- | --- | --- |
| Wallet key | `EVM_PRIVATE_KEY` | Optional; auto-generated at `~/.spraay/.session` if unset |
| Network | (config `network`) | `base-sepolia` (default) or `base` |
| CDP Paymaster URL | `CDP_PAYMASTER_URL` | Enables gasless; `https://api.developer.coinbase.com/rpc/v1/base/<KEY>` |
| RPC overrides | `SPRAAY_BASE_RPC_URL`, `SPRAAY_BASE_SEPOLIA_RPC_URL` | Optional |

**Mainnet safety:** mainnet (`base`) payouts require explicit confirmation (`confirm_mainnet`
tool param / `--confirm` flag); Base Sepolia is the default.

## On-chain contracts

| Network | Spray contract | USDC |
| --- | --- | --- |
| Base mainnet | `0x1646452F98E36A3c9Cfc3eDD8868221E207B5eEC` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | `0xfb1B884E489B0296CefadA2d8Db7CFbD1ED62f7A` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## Development

```bash
npm install
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest unit tests
npm run build        # tsup -> dist/
npm run smoke        # live smoke test on Base Sepolia (needs test USDC + a little ETH)
```

Run one test file: `npx vitest run test/payout.test.ts`.
Mainnet smoke: `SMOKE_NETWORK=base SMOKE_CONFIRM=1 npm run smoke` (spends real funds).

## Security

- The private key never leaves your machine and is never logged. Back it up with
  `spraaypay export-key`.
- Payouts are signed locally — never routed through a gateway.
- Amounts, fee, recipient count, and `paused` state are validated on-chain before signing.

## License

[MIT](LICENSE)

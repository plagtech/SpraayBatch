#!/usr/bin/env bash
#
# SpraayBatch one-line installer (ClawRouter-style).
#
#   curl -fsSL https://spraay.app/spraay-batch-install | bash
#
# Installs SpraayBatch as an OpenClaw plugin, then restarts the gateway so it loads.
# On first load the plugin auto-creates a non-custodial wallet at ~/.spraay/.session
# and prints the address to fund.
#
# Idempotent: safe to re-run to upgrade.

set -euo pipefail

PKG="spraay-batch"

info() { printf '\033[36m[spraay-batch]\033[0m %s\n' "$*"; }
err()  { printf '\033[31m[spraay-batch]\033[0m %s\n' "$*" >&2; }

# --- Prerequisites --------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  err "Node.js >= 22 is required but was not found. Install it and re-run."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  err "Node.js >= 22 is required (found $(node -v)). Please upgrade."
  exit 1
fi

if ! command -v openclaw >/dev/null 2>&1; then
  err "OpenClaw was not found on PATH."
  err "Install OpenClaw first, then re-run this installer."
  exit 1
fi

# --- Install / upgrade the plugin ----------------------------------------------
info "Installing the $PKG OpenClaw plugin..."
openclaw plugins install "$PKG"

# --- Restart the gateway so the plugin activates -------------------------------
info "Restarting the OpenClaw gateway..."
openclaw gateway restart || info "Could not restart automatically — restart the gateway manually."

info "Done. On first load SpraayBatch creates a wallet at ~/.spraay/.session."
info "Show it with:  spraay-batch info      Back it up with:  spraay-batch export-key"
info "Fund the address with USDC on Base to start paying."

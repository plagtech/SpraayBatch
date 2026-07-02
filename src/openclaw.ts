/**
 * Minimal OpenClaw plugin API surface that SpraayPay depends on.
 *
 * OpenClaw is an OPTIONAL peer dependency (this package also runs as a standalone
 * CLI), so we do not import its types at build time. These are a hand-maintained,
 * duck-typed subset of the real gateway API — kept deliberately small and matched
 * against the reference plugin in ./reference/ClawRouter (src/types.ts). Widen only
 * as we actually use more of the surface.
 */

export interface PluginLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

/** Passed to register()/activate() by the gateway on plugin load. */
export interface OpenClawPluginApi {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  /** Parsed ~/.openclaw/openclaw.json. */
  config: Record<string, unknown>;
  /** This plugin's config block (from configSchema in openclaw.plugin.json). */
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  registerTool: (tool: OpenClawToolDefinition, opts?: unknown) => void;
  registerCommand: (command: OpenClawPluginCommandDefinition) => void;
  resolvePath?: (input: string) => string;
}

export interface OpenClawPluginDefinition {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  register?: (api: OpenClawPluginApi) => void | Promise<void>;
  activate?: (api: OpenClawPluginApi) => void | Promise<void>;
  deactivate?: (api: OpenClawPluginApi) => void | Promise<void>;
}

/** Agent-callable tool. `execute` returns whatever the agent should see. */
export interface OpenClawToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
}

export interface PluginCommandContext {
  senderId?: string;
  channel: string;
  isAuthorizedSender: boolean;
  args?: string;
  commandBody: string;
  config: Record<string, unknown>;
}

export interface PluginCommandResult {
  text?: string;
  isError?: boolean;
}

export type PluginCommandHandler = (
  ctx: PluginCommandContext,
) => PluginCommandResult | Promise<PluginCommandResult>;

export interface OpenClawPluginCommandDefinition {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  requireAuth?: boolean;
  handler: PluginCommandHandler;
}

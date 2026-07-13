import readline from 'node:readline';
import { HokusaiApiError } from '@hokusai/core';
import {
  latestRouteWithCodex,
  previewOutcomeWithCodex,
  previewRoutePayloadWithCodex,
  privacyStatusWithCodex,
  promptOutcomeContributionWithCodex,
  routeTaskWithCodex,
  submitOutcomeWithCodex,
  type CodexOutcomeInput,
  type CodexRouteInput,
} from './plugin-commands.js';

export { runCodexOutcomePromptHookCli } from './outcome-prompt-hook.js';

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'hokusai_route',
    description:
      'Route a coding task through Hokusai and return an OpenAI model recommendation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['task'],
      properties: {
        task: { type: 'string' },
        taskId: { type: 'string' },
        currentModel: { type: 'string' },
      },
    },
  },
  {
    name: 'hokusai_preview_route_payload',
    description:
      'Preview the anonymized Hokusai routing payload without a network call.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['task'],
      properties: {
        task: { type: 'string' },
        taskId: { type: 'string' },
        currentModel: { type: 'string' },
      },
    },
  },
  {
    name: 'hokusai_submit_outcome',
    description:
      'Preview or submit an anonymized outcome report tied to the latest or specified correlation ID.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'actualModel',
        'recommendationAccepted',
        'completionStatus',
        'latencyBucket',
        'costBucket',
        'tokenBucket',
      ],
      properties: {
        correlationId: { type: 'string' },
        recommendedModel: { type: 'string' },
        actualModel: { type: 'string' },
        recommendationAccepted: { type: 'boolean' },
        completionStatus: {
          type: 'string',
          enum: ['succeeded', 'failed', 'abandoned', 'overridden', 'partial'],
        },
        latencyBucket: { type: 'string', enum: ['low', 'medium', 'high'] },
        costBucket: { type: 'string', enum: ['low', 'medium', 'high'] },
        tokenBucket: { type: 'string', enum: ['low', 'medium', 'high'] },
        userRating: { type: 'number' },
        notes: { type: 'string' },
        approve: { type: 'boolean' },
      },
    },
  },
  {
    name: 'hokusai_latest_route',
    description: 'Return the most recent stored Hokusai route summary.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'hokusai_privacy_status',
    description:
      'Report privacy, consent, retention, storage, and doctor-style status for the Codex plugin.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: 'hokusai_prompt_outcome_contribution',
    description:
      'Detect successful Codex completion events and return a consent-gated outcome contribution prompt.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        event: {
          description:
            'Hook event payload or text to inspect for task completion, passing tests, merged PRs, or closed issues.',
        },
        actualModel: { type: 'string' },
      },
    },
  },
];

function writeMessage(message: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResult(id: JsonRpcId, result: Record<string, unknown>) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function writeError(id: JsonRpcId, code: number, message: string) {
  writeMessage({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  });
}

function asToolResult(payload: Record<string, unknown>, isError = false) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload),
      },
    ],
    structuredContent: payload,
    isError,
  };
}

async function handleToolCall(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'hokusai_route':
      return routeTaskWithCodex(args as unknown as CodexRouteInput);
    case 'hokusai_preview_route_payload':
      return previewRoutePayloadWithCodex(args as unknown as CodexRouteInput);
    case 'hokusai_submit_outcome':
      if (args.approve === true) {
        return submitOutcomeWithCodex(args as unknown as CodexOutcomeInput);
      }
      return previewOutcomeWithCodex(args as unknown as CodexOutcomeInput);
    case 'hokusai_latest_route':
      return latestRouteWithCodex();
    case 'hokusai_privacy_status':
      return privacyStatusWithCodex();
    case 'hokusai_prompt_outcome_contribution':
      return promptOutcomeContributionWithCodex(args);
    default:
      return {
        ok: false,
        error: {
          code: 'E_INVALID_INPUT',
          message: `Unknown tool: ${name}`,
          remediation: 'Use one of the advertised Hokusai MCP tools.',
          details: undefined,
        },
      } as const;
  }
}

async function handleRequest(request: JsonRpcRequest) {
  const id = request.id ?? null;

  if (request.method === 'initialize') {
    writeResult(id, {
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: 'hokusai-codex-mcp',
        version: '0.1.1',
      },
      capabilities: {
        tools: {},
      },
      instructions:
        'Use Hokusai tools for routing and outcome reporting. Always preview outcome reports before sending them.',
    });
    return;
  }

  if (request.method === 'notifications/initialized') {
    return;
  }

  if (request.method === 'tools/list') {
    writeResult(id, {
      tools: TOOLS,
    });
    return;
  }

  if (request.method === 'tools/call') {
    const rawName = request.params?.name;
    const name = typeof rawName === 'string' ? rawName : '';
    const args =
      request.params && typeof request.params.arguments === 'object'
        ? (request.params.arguments as Record<string, unknown>)
        : {};
    const result = await handleToolCall(name, args);
    if (result.ok) {
      writeResult(
        id,
        asToolResult(result.value as unknown as Record<string, unknown>),
      );
      return;
    }
    writeResult(
      id,
      asToolResult(
        {
          code: result.error.code,
          message: result.error.message,
          remediation: result.error.remediation,
          ...(result.error.details ? { details: result.error.details } : {}),
        },
        true,
      ),
    );
    return;
  }

  writeError(id, -32601, `Method not found: ${request.method}`);
}

export async function runMcpServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    let request: JsonRpcRequest | undefined;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
      await handleRequest(request);
    } catch (error) {
      const failure = describeUnhandledError(error);
      process.stderr.write(`hokusai-codex-mcp: ${failure.message}\n`);

      // An unanswered request is worse than a failed one: the client blocks
      // until its own tool timeout (300s in Codex) and shows nothing. Any error
      // that escapes handleRequest — `executeRouteCommand` rethrows every
      // HokusaiApiError — must still come back as a response carrying this
      // request's id, or a rejected API key looks exactly like a hang.
      const id = request?.id;
      if (id !== undefined && id !== null) {
        writeResult(id, asToolResult({ ...failure }, true));
      }
    }
  }
}

export function describeUnhandledError(error: unknown): {
  code: string;
  message: string;
  remediation: string;
} {
  if (error instanceof HokusaiApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        code: 'E_INVALID_API_KEY',
        message: `Hokusai rejected the API key (HTTP ${error.status}).`,
        remediation:
          'HOKUSAI_API_KEY is set but the API rejected it as invalid or expired. Check the key, then restart Codex so the MCP server picks up the new value.',
      };
    }
    return {
      code: 'E_API',
      message: error.message,
      remediation: `The Hokusai API returned an error${
        error.status ? ` (HTTP ${error.status})` : ''
      }. Retry, and include request id ${error.requestId} if it persists.`,
    };
  }

  return {
    code: 'E_INTERNAL',
    message: error instanceof Error ? error.message : String(error),
    remediation:
      'The Hokusai MCP server failed to handle the request. Check HOKUSAI_API_KEY and network access, then retry.',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void runMcpServer();
}

import { listToolsPayload } from "@/lib/mcp/tools";
import { runTool, scopeForTool } from "@/lib/mcp/handlers";
import { requireApiKey, requireScope } from "@/lib/server/apiKeyAuth";
import { ApiError } from "@/lib/server/auth";
import { consumeRateLimit, MCP_LIMIT, MCP_SEND_LIMIT } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The MCP server the Ops Agent connects to.
 *
 * Streamable HTTP in its stateless JSON form: one POST carrying one JSON-RPC
 * request, one JSON response, no session. That is the only shape a serverless
 * function can honestly implement — there is no process to hold a session in
 * between requests — and it is what the MCP guidance recommends for remote
 * servers anyway.
 *
 * Written directly against JSON-RPC rather than through the TypeScript SDK's
 * transport. The SDK's StreamableHTTPServerTransport wants Node's `req`/`res`,
 * while the App Router deals in Web `Request`/`Response`; adapting between them
 * is more moving parts than the three methods below, and every one of those
 * parts would sit on the security boundary.
 *
 * Authorisation happens twice on purpose: the key is resolved before anything
 * else, and the specific scope is checked again immediately before the tool
 * runs. The second check is the one that matters — it is what stops a `read`
 * key calling `send_sms` — and it is deliberately not inferred from the first.
 */

const PROTOCOL_VERSION = "2025-06-18";

interface RpcRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

/** JSON-RPC error codes. -32000 onwards is the server-defined range. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const SERVER_ERROR = -32000;

function rpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

/**
 * A JSON-RPC error, carried in a 200.
 *
 * That is the protocol's shape rather than an oversight: a transport-level
 * status would tell the client the *call* failed, where the client needs to
 * know the *request* was understood and refused. HTTP statuses are reserved
 * below for the cases where the request never became a JSON-RPC call at all —
 * a missing or wrong key.
 */
function rpcError(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

/** A tool failure is a *result* with isError, not a protocol error. */
function toolFailure(id: unknown, message: string): Response {
  return rpcResult(id, {
    content: [{ type: "text", text: message }],
    isError: true,
  });
}

export async function POST(request: Request): Promise<Response> {
  // Before anything is parsed. An unauthenticated caller learns nothing about
  // the protocol, the tools, or whether this endpoint even speaks MCP.
  let key;
  try {
    key = await requireApiKey(request);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 401;
    const message = error instanceof ApiError ? error.message : "Not authorised.";
    return Response.json({ error: message }, { status });
  }

  let body: RpcRequest;
  try {
    body = (await request.json()) as RpcRequest;
  } catch {
    return rpcError(null, PARSE_ERROR, "Request body is not valid JSON.");
  }

  const id = body.id ?? null;
  const method = typeof body.method === "string" ? body.method : "";
  if (!method) return rpcError(id, INVALID_REQUEST, "Missing method.");

  const params = (body.params ?? {}) as Record<string, unknown>;

  try {
    switch (method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "grime-busters-crm", version: "1.0.0" },
          // Says what this key can do, so the agent's operator can see at a
          // glance whether it was issued the scopes they meant.
          instructions: `Grime Busters CRM. This key is allowed: ${key.scopes.join(", ") || "nothing"}. Money figures count payments when they arrived, not when work was completed.`,
        });

      case "notifications/initialized":
        // A notification carries no id and expects no result.
        return new Response(null, { status: 202 });

      case "tools/list":
        return rpcResult(id, { tools: listToolsPayload(key.scopes) });

      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        const args = (params.arguments ?? {}) as Record<string, unknown>;

        const scope = scopeForTool(name);
        if (!scope) {
          return toolFailure(id, `No tool called "${name}". Call tools/list to see what is available.`);
        }

        // The check that matters. Not inferred from the key being valid.
        requireScope(key, scope);

        // Charged per key, and harder for anything that reaches a customer.
        await consumeRateLimit(
          `key:${key.id}`,
          scope === "send" ? "mcp_send" : "mcp",
          scope === "send" ? MCP_SEND_LIMIT : MCP_LIMIT,
        );

        const result = await runTool(name, args, key);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      }

      case "ping":
        return rpcResult(id, {});

      default:
        return rpcError(id, METHOD_NOT_FOUND, `Unsupported method "${method}".`);
    }
  } catch (error) {
    // A refused scope or a bad argument is the agent's to fix, so it comes back
    // as a tool failure it can read and act on rather than a transport error it
    // can only retry.
    if (error instanceof ApiError) {
      if (error.status === 403 || error.status === 400 || error.status === 404) {
        return toolFailure(id, error.message);
      }
      return rpcError(id, SERVER_ERROR, error.message);
    }
    console.error("MCP tool failed", error);
    return rpcError(id, SERVER_ERROR, "Something went wrong running that tool.");
  }
}

/**
 * Deliberately not a tool listing.
 *
 * A GET here is a browser or a crawler, not an MCP client — the protocol is
 * POST-only in its stateless form. Answering with the catalogue would hand the
 * shape of the API to anybody who found the URL.
 */
export function GET(): Response {
  return Response.json(
    { error: "This is an MCP endpoint. POST JSON-RPC with an Authorization: Bearer header." },
    { status: 405 },
  );
}

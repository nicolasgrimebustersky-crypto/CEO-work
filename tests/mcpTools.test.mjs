/**
 * The Ops Agent's tool catalogue.
 *
 * These assert properties across the whole set rather than checking tools one
 * by one. The reason: the dangerous mistake here is not a wrong description, it
 * is a tool added later that quietly lands in the wrong scope — a `send_sms`
 * sibling marked `read` would be handed to every reporting key ever issued.
 * Testing the invariants catches that; testing each tool by name would not.
 */
import assert from "node:assert/strict";
import { test, describe } from "node:test";

const { TOOLS, TOOL_NAMES, findTool, listToolsPayload, toolsFor } = await import(
  "../lib/mcp/tools.ts"
);
const { SCOPES } = await import("../lib/apiKeys.ts");

describe("the catalogue holds together", () => {
  test("every tool has a real scope", () => {
    for (const tool of TOOLS) {
      assert.ok(SCOPES.includes(tool.scope), `${tool.name} has scope "${tool.scope}"`);
    }
  });

  test("no two tools share a name", () => {
    assert.equal(new Set(TOOL_NAMES).size, TOOL_NAMES.length);
  });

  test("names are snake_case and action-oriented", () => {
    for (const name of TOOL_NAMES) {
      assert.match(name, /^[a-z][a-z0-9_]*$/, name);
    }
  });

  test("every tool describes itself well enough to be chosen", () => {
    // The agent picks a tool from its description alone. A thin one gets the
    // wrong tool called, which for `send_sms` means a real text.
    for (const tool of TOOLS) {
      assert.ok(tool.description.length > 60, `${tool.name} description is too thin`);
      assert.ok(tool.title.length > 0, `${tool.name} has no title`);
    }
  });

  test("every schema is a closed object", () => {
    // additionalProperties: false means a hallucinated argument is rejected by
    // the schema instead of being silently ignored.
    for (const tool of TOOLS) {
      assert.equal(tool.inputSchema.type, "object", tool.name);
      assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
      assert.ok(Array.isArray(tool.inputSchema.required), tool.name);
    }
  });

  test("everything a tool requires is a property it declares", () => {
    for (const tool of TOOLS) {
      const properties = Object.keys(tool.inputSchema.properties ?? {});
      for (const required of tool.inputSchema.required ?? []) {
        assert.ok(properties.includes(required), `${tool.name} requires undeclared "${required}"`);
      }
    }
  });
});

describe("the annotations tell the truth", () => {
  test("read tools are marked read-only and nothing else is", () => {
    for (const tool of TOOLS) {
      assert.equal(
        tool.annotations.readOnlyHint,
        tool.scope === "read",
        `${tool.name} is scope ${tool.scope} but readOnlyHint ${tool.annotations.readOnlyHint}`,
      );
    }
  });

  test("anything that reaches a customer is marked destructive", () => {
    // Not "destructive" as in deleting data — as in it cannot be taken back.
    // A text arrives on a real phone.
    for (const tool of TOOLS) {
      if (tool.scope !== "send") continue;
      assert.equal(tool.annotations.destructiveHint, true, tool.name);
      assert.equal(tool.annotations.openWorldHint, true, `${tool.name} touches the outside world`);
    }
  });

  test("no read tool is ever marked destructive", () => {
    for (const tool of toolsFor(["read"])) {
      assert.equal(tool.annotations.destructiveHint, false, tool.name);
    }
  });

  test("only read tools claim to be idempotent", () => {
    for (const tool of TOOLS) {
      if (tool.annotations.idempotentHint) {
        assert.equal(tool.scope, "read", `${tool.name} claims idempotence`);
      }
    }
  });
});

describe("what each scope actually unlocks", () => {
  test("a read key gets the reporting tools and nothing that writes", () => {
    const names = toolsFor(["read"]).map((t) => t.name);
    assert.ok(names.includes("money_summary"));
    assert.ok(names.includes("find_customer"));
    assert.ok(!names.includes("send_sms"));
    assert.ok(!names.includes("create_lead"));
  });

  test("a write key cannot text anybody", () => {
    // The whole point of separating the tiers.
    const names = toolsFor(["read", "write"]).map((t) => t.name);
    assert.ok(names.includes("create_lead"));
    assert.ok(names.includes("draft_estimate"));
    assert.ok(!names.includes("send_sms"));
    assert.ok(!names.includes("schedule_job"));
  });

  test("booking a job needs send, because booking sends a text", () => {
    assert.equal(findTool("schedule_job").scope, "send");
  });

  test("drafting an estimate does not, because it sends nothing", () => {
    assert.equal(findTool("draft_estimate").scope, "write");
    assert.match(findTool("draft_estimate").description, /NOT sent|not sent/);
  });

  test("no scopes means no tools at all", () => {
    assert.deepEqual(toolsFor([]), []);
  });

  test("an invented scope unlocks nothing", () => {
    assert.deepEqual(toolsFor(["admin", "root", "*"]), []);
  });
});

describe("what the agent is shown", () => {
  test("only tools the key can actually call", () => {
    // Advertising a tool that will be refused teaches the agent to keep trying
    // and costs a round trip each time.
    const payload = listToolsPayload(["read"]);
    assert.ok(payload.length > 0);
    assert.ok(!payload.some((tool) => tool.name === "send_sms"));
  });

  test("each entry carries what MCP expects", () => {
    for (const tool of listToolsPayload(["read", "write", "send"])) {
      assert.equal(typeof tool.name, "string");
      assert.equal(typeof tool.description, "string");
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(typeof tool.annotations.readOnlyHint, "boolean");
    }
  });

  test("the payload covers every tool when every scope is held", () => {
    assert.equal(listToolsPayload(["read", "write", "send"]).length, TOOLS.length);
  });
});

describe("looking a tool up", () => {
  test("by name", () => {
    assert.equal(findTool("money_summary").scope, "read");
  });

  test("an unknown name is null, not a throw", () => {
    // An agent will invent a tool name eventually. That must be a clean
    // "no such tool", not a 500.
    assert.equal(findTool("delete_everything"), null);
    assert.equal(findTool(""), null);
  });
});

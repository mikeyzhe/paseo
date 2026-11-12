import { describe, expect, it } from "vitest";
import { CreateAgentRequestMessageSchema, SendAgentMessageRequestSchema } from "./messages";

describe("create_agent_request notifyOnFinish", () => {
  it("accepts an explicit opt-in from a caller-scoped client", () => {
    const parsed = CreateAgentRequestMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-notify",
      config: { provider: "codex", cwd: "/tmp/project" },
      callerAgentId: "parent-agent",
      notifyOnFinish: true,
      initialPrompt: "hello",
    });

    expect(parsed.notifyOnFinish).toBe(true);
  });

  it("leaves notifyOnFinish undefined for legacy clients that omit it", () => {
    const parsed = CreateAgentRequestMessageSchema.parse({
      type: "create_agent_request",
      requestId: "req-legacy",
      config: { provider: "codex", cwd: "/tmp/project" },
      initialPrompt: "hello",
    });

    expect(parsed.notifyOnFinish).toBeUndefined();
  });
});

describe("send_agent_message_request notifyOnFinish", () => {
  it("accepts an explicit opt-in from a caller-scoped client", () => {
    const parsed = SendAgentMessageRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "request-notify",
      agentId: "agent-1",
      text: "Follow this instruction",
      sourceAgentId: "parent-agent",
      notifyOnFinish: true,
    });

    expect(parsed.notifyOnFinish).toBe(true);
  });

  it("leaves notifyOnFinish undefined for legacy clients that omit it", () => {
    const parsed = SendAgentMessageRequestSchema.parse({
      type: "send_agent_message_request",
      requestId: "request-legacy",
      agentId: "agent-1",
      text: "Keep the old behavior",
      sourceAgentId: "parent-agent",
    });

    expect(parsed.notifyOnFinish).toBeUndefined();
  });
});

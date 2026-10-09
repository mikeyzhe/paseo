import { SendAgentMessageResponseMessageSchema } from "./messages";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("send_agent_message_response disposition and code", () => {
  it("carries an optional disposition on accepted sends", () => {
    const parsed = SendAgentMessageResponseMessageSchema.parse({
      type: "send_agent_message_response",
      payload: {
        requestId: "request-1",
        agentId: "agent-1",
        accepted: true,
        error: null,
        disposition: "steered",
      },
    });
    expect(parsed.payload.disposition).toBe("steered");
  });

  it("carries an optional code on refused sends", () => {
    const parsed = SendAgentMessageResponseMessageSchema.parse({
      type: "send_agent_message_response",
      payload: {
        requestId: "request-2",
        agentId: "agent-1",
        accepted: false,
        error: "A foreground turn is already active",
        code: "turn_active",
      },
    });
    expect(parsed.payload.code).toBe("turn_active");
  });

  it("accepts legacy responses without the new fields", () => {
    const parsed = SendAgentMessageResponseMessageSchema.parse({
      type: "send_agent_message_response",
      payload: {
        requestId: "request-3",
        agentId: "agent-1",
        accepted: true,
        error: null,
      },
    });
    expect(parsed.payload.disposition).toBeUndefined();
    expect(parsed.payload.code).toBeUndefined();
  });

  it("lets legacy clients ignore the new fields", () => {
    const LegacySendAgentMessageResponseSchema = z.object({
      type: z.literal("send_agent_message_response"),
      payload: z.object({
        requestId: z.string(),
        agentId: z.string(),
        accepted: z.boolean(),
        error: z.string().nullable(),
      }),
    });
    const legacy = LegacySendAgentMessageResponseSchema.parse({
      type: "send_agent_message_response",
      payload: {
        requestId: "request-4",
        agentId: "agent-1",
        accepted: false,
        error: "Agent not found: agent-1",
        code: "agent_missing",
      },
    });
    expect(legacy.payload).toEqual({
      requestId: "request-4",
      agentId: "agent-1",
      accepted: false,
      error: "Agent not found: agent-1",
    });
  });
});

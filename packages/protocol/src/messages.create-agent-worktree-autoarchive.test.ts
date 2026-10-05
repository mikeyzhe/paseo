import { describe, expect, test } from "vitest";

import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

describe("create_agent_request lifecycle fields", () => {
  test("accepts optional worktree branch-off target and autoArchive", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId: "create-agent-worktree",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
      worktree: {
        mode: "branch-off",
        newBranch: "agent-lifecycle-dispatch",
        base: "main",
      },
      autoArchive: true,
    });

    expect(parsed).toEqual({
      type: "create_agent_request",
      requestId: "create-agent-worktree",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
      worktree: {
        mode: "branch-off",
        newBranch: "agent-lifecycle-dispatch",
        base: "main",
      },
      autoArchive: true,
      labels: {},
    });
  });

  test("accepts an optional compatible-child reuse policy", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId: "reuse-compatible-child",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
      callerAgentId: "parent-agent",
      reusePolicy: "compatible",
    });

    expect(parsed).toEqual({
      type: "create_agent_request",
      requestId: "reuse-compatible-child",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
      callerAgentId: "parent-agent",
      reusePolicy: "compatible",
      labels: {},
    });
  });

  test("keeps legacy create_agent_request defaults unchanged", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "create_agent_request",
      requestId: "legacy-create-agent",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
    });

    expect(parsed).toEqual({
      type: "create_agent_request",
      requestId: "legacy-create-agent",
      config: {
        provider: "codex",
        cwd: "/repo/app",
      },
      labels: {},
    });
  });

  test("accepts the optional create disposition in the existing status response", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "status",
      payload: {
        status: "agent_created",
        requestId: "reuse-result",
        agentId: "child-agent",
        disposition: "reused",
        agent: {
          id: "child-agent",
          provider: "codex",
          cwd: "/repo/app",
          model: "gpt-5.6-sol",
          createdAt: "2026-09-09T00:00:00.000Z",
          updatedAt: "2026-09-09T00:00:00.000Z",
          lastUserMessageAt: null,
          status: "running",
          activeTurn: null,
          capabilities: {},
          currentModeId: null,
          availableModes: [],
          features: [],
          pendingPermissions: [],
          persistence: null,
          title: "helper_1",
          labels: { "paseo.parent-agent-id": "parent-agent" },
          requiresAttention: false,
          attentionReason: null,
          attentionTimestamp: null,
        },
      },
    });

    expect(parsed.payload).toMatchObject({
      status: "agent_created",
      disposition: "reused",
    });
  });
});

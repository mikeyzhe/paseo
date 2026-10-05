import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { AgentManager, type ManagedAgent } from "./agent-manager.js";
import {
  compareReusableAgents,
  isCompatibleReusableAgent,
  MIN_REUSABLE_CONTEXT_REMAINING_RATIO,
  type ReusableAgentCriteria,
} from "./reusable-agent.js";

const logger = createTestLogger();
const managers: AgentManager[] = [];

afterEach(async () => {
  await Promise.all(
    managers.splice(0).map(async (manager) => {
      manager.prepareForShutdown();
      await Promise.all(manager.listAgents().map((agent) => manager.closeAgent(agent.id)));
      await manager.flushForShutdown();
    }),
  );
});

function candidate(overrides: Partial<ManagedAgent> = {}): ManagedAgent {
  return {
    id: "child-agent",
    provider: "codex",
    cwd: "/repo",
    workspaceId: "workspace-1",
    lifecycle: "idle",
    session: {} as ManagedAgent["session"],
    capabilities: {} as ManagedAgent["capabilities"],
    config: {
      provider: "codex",
      cwd: "/repo",
      model: "gpt-5.6-sol",
      modeId: "full-access",
      thinkingOptionId: "extra",
      featureValues: { fast: true },
    },
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-02T00:00:00.000Z"),
    availableModes: [],
    features: [],
    currentModeId: "full-access",
    pendingPermissions: new Map(),
    bufferedPermissionResolutions: new Map(),
    inFlightPermissionResponses: new Set(),
    pendingReplacement: false,
    persistence: null,
    historyPrimed: true,
    lastUserMessageAt: null,
    activeTurnId: null,
    activeTurnStartedAt: null,
    attention: { requiresAttention: false },
    foregroundTurnWaiters: new Set(),
    finalizedForegroundTurnIds: new Set(),
    unsubscribeSession: null,
    activeForegroundTurnId: null,
    labels: { "paseo.parent-agent-id": "parent-agent", lane: "implementation" },
    ...overrides,
  } as ManagedAgent;
}

function criteria(): ReusableAgentCriteria {
  return {
    parentAgentId: "parent-agent",
    workspaceId: "workspace-1",
    config: {
      provider: "codex",
      cwd: "/repo",
      model: "gpt-5.6-sol",
      modeId: "full-access",
      thinkingOptionId: "extra",
      featureValues: { fast: true },
    },
    labels: { "paseo.parent-agent-id": "parent-agent", lane: "implementation" },
  };
}

describe("compatible reusable agents", () => {
  test("matches only idle direct children with the same workspace, settings, and labels", () => {
    const input = criteria();
    expect(isCompatibleReusableAgent(candidate(), input)).toBe(true);
    expect(
      isCompatibleReusableAgent(
        candidate({ labels: { ...input.labels, "paseo.open-agent-tab.client-1": "true" } }),
        input,
      ),
    ).toBe(true);
    expect(isCompatibleReusableAgent(candidate({ lifecycle: "running" }), input)).toBe(false);
    expect(isCompatibleReusableAgent(candidate({ workspaceId: "workspace-2" }), input)).toBe(false);
    expect(
      isCompatibleReusableAgent(
        candidate({ labels: { "paseo.parent-agent-id": "other-parent" } }),
        input,
      ),
    ).toBe(false);
    expect(
      isCompatibleReusableAgent(
        candidate({ config: { ...candidate().config, model: "gpt-5.6-terra" } }),
        input,
      ),
    ).toBe(false);
    expect(
      isCompatibleReusableAgent(candidate(), {
        ...input,
        config: { ...input.config, model: undefined },
      }),
    ).toBe(false);
  });

  test("rejects a child with less than the context reserve", () => {
    const maximum = 1_000_000;
    const used = maximum * (1 - MIN_REUSABLE_CONTEXT_REMAINING_RATIO) + 1;
    expect(
      isCompatibleReusableAgent(
        candidate({
          lastUsage: {
            contextWindowMaxTokens: maximum,
            contextWindowUsedTokens: used,
          },
        }),
        criteria(),
      ),
    ).toBe(false);
  });

  test("prefers the compatible child with more measured context remaining", () => {
    const fuller = candidate({
      id: "fuller",
      lastUsage: { contextWindowMaxTokens: 1_000_000, contextWindowUsedTokens: 600_000 },
    });
    const emptier = candidate({
      id: "emptier",
      lastUsage: { contextWindowMaxTokens: 1_000_000, contextWindowUsedTokens: 50_000 },
    });
    expect([fuller, emptier].sort(compareReusableAgents).map((agent) => agent.id)).toEqual([
      "emptier",
      "fuller",
    ]);
  });
});

test("an idle child claim is exclusive until released", async () => {
  const manager = new AgentManager({ clients: createTestAgentClients(), logger });
  managers.push(manager);
  const cwd = process.cwd();
  const parent = await manager.createAgent(
    { provider: "codex", cwd, model: "gpt-5.6-sol" },
    undefined,
    { workspaceId: "workspace-1" },
  );
  const child = await manager.createAgent(
    { provider: "codex", cwd, model: "gpt-5.6-sol" },
    undefined,
    {
      workspaceId: "workspace-1",
      labels: { "paseo.parent-agent-id": parent.id },
    },
  );
  const claimCriteria: ReusableAgentCriteria = {
    parentAgentId: parent.id,
    workspaceId: "workspace-1",
    config: { provider: "codex", cwd, model: "gpt-5.6-sol" },
    labels: child.labels,
  };

  expect((await manager.claimReusableAgent(claimCriteria))?.id).toBe(child.id);
  expect(await manager.claimReusableAgent(claimCriteria)).toBeNull();
  expect(() => manager.streamAgent(child.id, "unclaimed prompt")).toThrow(
    `Agent ${child.id} is reserved for a delegated task`,
  );
  const stream = manager.streamClaimedReusableAgent(child.id, "claimed prompt");
  expect(manager.hasInFlightRun(child.id)).toBe(true);
  for await (const _ of stream) {
    // Drain the real fake-provider turn so the child becomes idle again.
  }
  expect((await manager.claimReusableAgent(claimCriteria))?.id).toBe(child.id);
  manager.releaseReusableAgentClaim(child.id);
});

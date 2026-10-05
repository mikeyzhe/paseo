import { isDeepStrictEqual } from "node:util";

import { getParentAgentIdFromLabels, isOpenAgentTabLabel } from "@getpaseo/protocol/agent-labels";

import type { ManagedAgent } from "./agent-manager.js";
import type { AgentSessionConfig } from "./agent-sdk-types.js";

export const MIN_REUSABLE_CONTEXT_REMAINING_RATIO = 0.2;

export interface ReusableAgentCriteria {
  parentAgentId: string;
  workspaceId: string;
  config: AgentSessionConfig;
  labels: Record<string, string>;
}

interface ComparableAgentConfig {
  provider: string;
  cwd: string;
  model: string;
  modeId: string | null;
  thinkingOptionId: string | null;
  featureValues: Record<string, unknown>;
  providerOptions: Record<string, unknown>;
  toolPolicy: unknown;
  systemPrompt: string | null;
  mcpServers: Record<string, unknown>;
  internal: boolean;
}

function comparableConfig(config: AgentSessionConfig): ComparableAgentConfig | null {
  const model = config.model?.trim();
  if (!model) {
    return null;
  }
  return {
    provider: config.provider,
    cwd: config.cwd,
    model,
    modeId: config.modeId ?? null,
    thinkingOptionId: config.thinkingOptionId ?? null,
    featureValues: config.featureValues ?? {},
    providerOptions: config.providerOptions ?? {},
    toolPolicy: config.toolPolicy ?? null,
    systemPrompt: config.systemPrompt ?? null,
    mcpServers: config.mcpServers ?? {},
    internal: config.internal ?? false,
  };
}

function comparableAgentConfig(agent: ManagedAgent): ComparableAgentConfig | null {
  const config = comparableConfig(agent.config);
  if (!config) {
    return null;
  }
  return {
    ...config,
    modeId: agent.currentModeId ?? config.modeId,
  };
}

function relationshipLabels(labels: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(labels).filter(([name]) => !isOpenAgentTabLabel(name)));
}

export function reusableContextRemainingRatio(agent: ManagedAgent): number | null {
  const maximum = agent.lastUsage?.contextWindowMaxTokens;
  const used = agent.lastUsage?.contextWindowUsedTokens;
  if (
    typeof maximum !== "number" ||
    !Number.isFinite(maximum) ||
    maximum <= 0 ||
    typeof used !== "number" ||
    !Number.isFinite(used) ||
    used < 0
  ) {
    return null;
  }
  return Math.max(0, Math.min(1, (maximum - used) / maximum));
}

export function isCompatibleReusableAgent(
  agent: ManagedAgent,
  criteria: ReusableAgentCriteria,
): boolean {
  if (
    agent.lifecycle !== "idle" ||
    agent.internal ||
    agent.owner !== undefined ||
    agent.pendingReplacement ||
    agent.activeTurnId !== null ||
    agent.workspaceId !== criteria.workspaceId ||
    getParentAgentIdFromLabels(agent.labels) !== criteria.parentAgentId ||
    agent.pendingPermissions.size > 0
  ) {
    return false;
  }

  const remainingRatio = reusableContextRemainingRatio(agent);
  if (remainingRatio !== null && remainingRatio < MIN_REUSABLE_CONTEXT_REMAINING_RATIO) {
    return false;
  }

  const candidateConfig = comparableAgentConfig(agent);
  const requestedConfig = comparableConfig(criteria.config);
  return (
    candidateConfig !== null &&
    requestedConfig !== null &&
    isDeepStrictEqual(candidateConfig, requestedConfig) &&
    isDeepStrictEqual(relationshipLabels(agent.labels), relationshipLabels(criteria.labels))
  );
}

export function compareReusableAgents(left: ManagedAgent, right: ManagedAgent): number {
  const leftRemaining = reusableContextRemainingRatio(left);
  const rightRemaining = reusableContextRemainingRatio(right);
  if (leftRemaining !== null && rightRemaining !== null && leftRemaining !== rightRemaining) {
    return rightRemaining - leftRemaining;
  }
  if (leftRemaining !== null && rightRemaining === null) {
    return -1;
  }
  if (leftRemaining === null && rightRemaining !== null) {
    return 1;
  }
  return left.updatedAt.getTime() - right.updatedAt.getTime();
}

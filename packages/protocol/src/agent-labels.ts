export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
export const PARENT_HANDOFF_LABEL = "paseo.parent-handoff";

export const PARENT_HANDOFF_STATES = [
  "pending",
  "permission_delivered",
  "completion_delivered",
] as const;

export type ParentHandoffState = (typeof PARENT_HANDOFF_STATES)[number];
const OPEN_AGENT_TAB_LABEL_PREFIX = "paseo.open-agent-tab.";

export function getOpenAgentTabLabel(clientId: string): string {
  return `${OPEN_AGENT_TAB_LABEL_PREFIX}${clientId}`;
}

export function isOpenAgentTabLabel(label: string): boolean {
  return label.startsWith(OPEN_AGENT_TAB_LABEL_PREFIX);
}

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  const parentAgentId = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof parentAgentId === "string" && parentAgentId.trim().length > 0
    ? parentAgentId.trim()
    : null;
}

export function getParentHandoffStateFromLabels(
  labels: Record<string, unknown> | null | undefined,
): ParentHandoffState | null {
  const state = labels?.[PARENT_HANDOFF_LABEL];
  return typeof state === "string" && PARENT_HANDOFF_STATES.includes(state as ParentHandoffState)
    ? (state as ParentHandoffState)
    : null;
}

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}

export function hasOpenAgentTab(labels: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => isOpenAgentTabLabel(label) && value === "true",
  );
}

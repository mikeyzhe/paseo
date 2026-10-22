import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ProviderEvent, ProviderTimelineItem } from "@getpaseo/plugin/server/provider";
import type { Step } from "./wire.js";

interface ChildSessionState {
  sessionId: string;
  toolCallId: string;
  title: string;
  description: string;
  cwd: string;
  logPath: string;
  turnId: string;
  emittedStepIndices: Set<number>;
  lastEmittedTextByStep: Map<number, string>;
  status: "running" | "completed" | "failed" | "canceled";
}

interface TranscriptLine {
  step_index?: number;
  type?: string;
  created_at?: string;
  content?: string;
  tool_calls?: Array<{
    name?: string;
    args?: Record<string, unknown>;
  }>;
}

export class Children {
  private readonly children = new Map<string, ChildSessionState>();

  constructor(
    private readonly parentId: string,
    private readonly cwd: string,
    private readonly emit: (event: ProviderEvent) => void,
  ) {}

  observeStep(
    step: Step,
    toolCallId: string,
    previousTool?: Extract<ProviderTimelineItem, { type: "tool_call" }>,
  ): void {
    const subagents = step.subagent_info?.subagents;
    if (!subagents || subagents.length === 0) return;
    const fallbackRole = extractToolRole(previousTool);
    for (const child of subagents) {
      const childId = child.conversation_id?.trim();
      if (!childId) continue;
      let existing = this.children.get(childId);
      const role = child.role.trim() || fallbackRole;
      const title = role || child.type_name.trim() || childId;
      const description = child.initial_prompt.trim();
      const childCwd = resolveWorkspacePath(child.workspace_uris[0], this.cwd) ?? this.cwd;
      const logPath =
        resolveFileUriPath(child.log_uri, this.cwd) ?? defaultTranscriptPath(childId, this.cwd);
      if (!existing) {
        existing = {
          sessionId: childId,
          toolCallId,
          title,
          description,
          cwd: childCwd,
          logPath,
          turnId: `${childId}:turn`,
          emittedStepIndices: new Set(),
          lastEmittedTextByStep: new Map(),
          status: "running",
        };
        this.children.set(childId, existing);
        this.emit({
          type: "session.opened",
          sessionId: childId,
          parentSessionId: this.parentId,
          toolCallId,
          capabilities: [],
          restoration: "parent",
          cwd: childCwd,
          title,
          description: description || undefined,
        });
      }
      if (step.state === "ERROR") {
        this.settleChild(existing, "failed");
      } else {
        void this.syncTranscript(existing);
      }
    }
  }

  async finishTurn(state: "completed" | "failed" | "canceled"): Promise<void> {
    const active = [...this.children.values()].filter((child) => child.status === "running");
    await Promise.all(
      active.map(async (child) => {
        await this.syncTranscript(child);
        this.settleChild(child, state);
      }),
    );
  }

  close(): void {
    for (const child of this.children.values()) {
      if (child.status === "running") {
        this.settleChild(child, "canceled");
      }
      this.emit({ type: "session.closed", sessionId: child.sessionId });
    }
    this.children.clear();
  }

  private settleChild(child: ChildSessionState, state: "completed" | "failed" | "canceled"): void {
    if (child.status === state) return;
    child.status = state;
    this.emit({
      type: "session.turn",
      sessionId: child.sessionId,
      turnId: child.turnId,
      state,
    });
  }

  private async syncTranscript(child: ChildSessionState): Promise<void> {
    if (!child.logPath) return;
    let raw: string;
    try {
      raw = await readFile(child.logPath, "utf8");
    } catch {
      return;
    }
    const lines = raw.split(/\r?\n/);
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      let parsed: TranscriptLine;
      try {
        parsed = JSON.parse(trimmed) as TranscriptLine;
      } catch {
        continue;
      }
      if (parsed.type !== "PLANNER_RESPONSE" || typeof parsed.step_index !== "number") continue;
      const stepIndex = parsed.step_index;
      const text = extractPlannerOutput(parsed);
      if (!text) continue;
      const previous = child.lastEmittedTextByStep.get(stepIndex);
      if (previous === text && child.emittedStepIndices.has(stepIndex)) continue;
      child.emittedStepIndices.add(stepIndex);
      child.lastEmittedTextByStep.set(stepIndex, text);
      const itemId = `${child.sessionId}:${stepIndex}`;
      this.emit({
        type: "timeline.item",
        sessionId: child.sessionId,
        timestamp: parsed.created_at,
        item: {
          type: "assistant_message",
          id: itemId,
          messageId: itemId,
          text,
        },
      });
    }
  }
}

function extractToolRole(tool?: Extract<ProviderTimelineItem, { type: "tool_call" }>): string {
  if (!tool || tool.detail.type !== "unknown") return "";
  const input = tool.detail.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  return typeof input.Role === "string" ? input.Role.trim() : "";
}

function extractPlannerOutput(step: TranscriptLine): string {
  if (typeof step.content === "string" && step.content.trim().length > 0) {
    return step.content.trim();
  }
  if (!Array.isArray(step.tool_calls)) return "";
  for (const call of step.tool_calls) {
    if (call?.name !== "send_message" || !call.args) continue;
    const rawMessage = call.args.Message;
    if (typeof rawMessage !== "string" || rawMessage.trim().length === 0) continue;
    const unquoted = unquoteJsonString(rawMessage.trim());
    if (unquoted.length > 0) return unquoted;
  }
  return "";
}

function unquoteJsonString(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed.trim();
    } catch {
      return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').trim();
    }
  }
  return value;
}

function resolveFileUriPath(uri: string | undefined, cwd: string): string | undefined {
  const raw = uri?.trim();
  if (!raw) return undefined;
  const home = homeFromCwd(cwd) ?? os.homedir();
  const trimmed = raw.replaceAll("<HOME>", home).replaceAll("<WORKSPACE>", cwd);
  if (trimmed.startsWith("file://")) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return undefined;
    }
  }
  if (path.isAbsolute(trimmed)) return trimmed;
  return undefined;
}

function resolveWorkspacePath(uri: string | undefined, cwd: string): string | undefined {
  return resolveFileUriPath(uri, cwd);
}

function defaultTranscriptPath(conversationId: string, cwd: string): string {
  const home = homeFromCwd(cwd) ?? os.homedir();
  return path.join(
    home,
    ".gemini",
    "antigravity-cli",
    "brain",
    conversationId,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
}

function homeFromCwd(cwd: string): string | undefined {
  const parts = cwd.split(path.sep).filter(Boolean);
  if (parts.length >= 2 && (parts[0] === "Users" || parts[0] === "home")) {
    return path.join(path.sep, parts[0], parts[1]);
  }
  return undefined;
}

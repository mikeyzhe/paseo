import { expect, test, vi } from "vitest";
import type { Logger } from "pino";
import type { ArchiveAgentResult } from "./agent/lifecycle-command.js";
import type { StoredAgentRecord } from "./agent/agent-storage.js";
import { Session, broadcastAgentArchiveToSessions } from "./session.js";

function archivedResult(): ArchiveAgentResult {
  const record = {
    id: "agent-1",
    archivedAt: "2026-10-05T00:00:00.000Z",
  } as StoredAgentRecord;
  return { agentId: "agent-1", archivedAt: record.archivedAt, record };
}

function stubLogger() {
  return { warn: vi.fn() } as unknown as Logger;
}

test("broadcast reaches every session", async () => {
  const archived = archivedResult();
  const first = { emitAgentArchiveForExternalMutation: vi.fn().mockResolvedValue(undefined) };
  const second = { emitAgentArchiveForExternalMutation: vi.fn().mockResolvedValue(undefined) };
  const logger = stubLogger();

  await broadcastAgentArchiveToSessions([first, second], archived, logger);

  expect(first.emitAgentArchiveForExternalMutation).toHaveBeenCalledWith(archived);
  expect(second.emitAgentArchiveForExternalMutation).toHaveBeenCalledWith(archived);
  expect(logger.warn).not.toHaveBeenCalled();
});

test("a throwing session is logged and skipped, never rejects", async () => {
  const archived = archivedResult();
  const bad = {
    emitAgentArchiveForExternalMutation: vi.fn().mockRejectedValue(new Error("boom")),
  };
  const good = { emitAgentArchiveForExternalMutation: vi.fn().mockResolvedValue(undefined) };
  const logger = stubLogger();

  await expect(broadcastAgentArchiveToSessions([bad, good], archived, logger)).resolves.toBe(
    undefined,
  );

  expect(good.emitAgentArchiveForExternalMutation).toHaveBeenCalledWith(archived);
  expect(logger.warn).toHaveBeenCalledTimes(1);
});

test("broadcast with no sessions resolves quietly", async () => {
  const logger = stubLogger();
  await expect(
    broadcastAgentArchiveToSessions([], archivedResult(), logger),
  ).resolves.toBeUndefined();
  expect(logger.warn).not.toHaveBeenCalled();
});

function sessionWithAgentUpdates(agentUpdates: {
  hasSubscription: () => boolean;
  emitStoredRecord: (record: StoredAgentRecord) => Promise<{ workspaceId?: string | null }>;
}) {
  return {
    agentUpdates,
    emitWorkspaceUpdateForWorkspaceId: vi.fn().mockResolvedValue(undefined),
  };
}

test("external archive mirrors the record to a subscribed session", async () => {
  const archived = archivedResult();
  const emitStoredRecord = vi.fn().mockResolvedValue({ workspaceId: "ws-1" });
  const host = sessionWithAgentUpdates({ hasSubscription: () => true, emitStoredRecord });

  await Session.prototype.emitAgentArchiveForExternalMutation.call(
    host as unknown as Session,
    archived,
  );

  expect(emitStoredRecord).toHaveBeenCalledWith(archived.record);
  expect(host.emitWorkspaceUpdateForWorkspaceId).toHaveBeenCalledWith("ws-1");
});

test("external archive skips sessions without a subscription", async () => {
  const emitStoredRecord = vi.fn();
  const host = sessionWithAgentUpdates({ hasSubscription: () => false, emitStoredRecord });

  await Session.prototype.emitAgentArchiveForExternalMutation.call(
    host as unknown as Session,
    archivedResult(),
  );

  expect(emitStoredRecord).not.toHaveBeenCalled();
  expect(host.emitWorkspaceUpdateForWorkspaceId).not.toHaveBeenCalled();
});

test("external archive without a workspace skips the workspace update", async () => {
  const archived = archivedResult();
  const emitStoredRecord = vi.fn().mockResolvedValue({ workspaceId: null });
  const host = sessionWithAgentUpdates({ hasSubscription: () => true, emitStoredRecord });

  await Session.prototype.emitAgentArchiveForExternalMutation.call(
    host as unknown as Session,
    archived,
  );

  expect(emitStoredRecord).toHaveBeenCalledWith(archived.record);
  expect(host.emitWorkspaceUpdateForWorkspaceId).not.toHaveBeenCalled();
});

import { expect, test, vi } from "vitest";
import type { MspConnection } from "../server/connection.js";
import { Children } from "../server/children.js";
import { MuseError } from "../server/errors.js";
import { itemSchema, type WireItem } from "../server/wire.js";
import type { ProviderEvent } from "@getpaseo/plugin/server/provider";

interface Call {
  method: string;
  params: Record<string, unknown>;
  timeoutMs: number | undefined;
}

function childItem(revision: number): WireItem {
  return itemSchema.parse({
    itemId: "spawn-1",
    revision,
    kind: "subagent",
    status: revision === 1 ? "inProgress" : "completed",
    childSessionId: "child-1",
    callId: "call-1",
    role: "worker",
    objective: "Child objective",
  });
}

function childMessage(revision: number): WireItem {
  return itemSchema.parse({
    itemId: "child-msg-1",
    revision,
    kind: "agentMessage",
    status: "completed",
    text: "CHILD_OK",
  });
}

function setup(respond: (method: string, params: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  const events: ProviderEvent[] = [];
  const host = {
    request: async (method: string, params: object, _schema: unknown, timeoutMs?: number) => {
      calls.push({ method, params: params as Record<string, unknown>, timeoutMs });
      const result = respond(method, params as Record<string, unknown>);
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as MspConnection;
  const children = new Children(host, "parent-1", "/work", (event) => events.push(event));
  return { calls, events, children };
}

const childSession = {
  session: { sessionId: "child-1", workspaceRoot: null, title: "child" },
  viewCursor: "v:0",
};

test("child session/read and view/page pass an explicit 60s timeout", async () => {
  const { calls, children } = setup((method) => {
    if (method === "session/read") return childSession;
    return { events: [], nextCursor: null };
  });
  await children.update(childItem(1));
  expect(calls.map((call) => [call.method, call.timeoutMs])).toEqual([
    ["session/read", 60_000],
    ["view/page", 60_000],
  ]);
});

test("refresh retries a child whose open failed and emits session.opened once", async () => {
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  let reads = 0;
  const { calls, events, children } = setup((method) => {
    if (method === "session/read") {
      reads++;
      if (reads === 1) throw new MuseError("timeout", "Muse session/read timed out");
      return childSession;
    }
    return { events: [], nextCursor: null };
  });
  await children.update(childItem(1));
  expect(events.filter((event) => event.type === "session.opened")).toEqual([]);
  await children.refresh();
  expect(calls.filter((call) => call.method === "session/read")).toHaveLength(2);
  expect(events.filter((event) => event.type === "session.opened")).toHaveLength(1);
  await children.refresh();
  expect(events.filter((event) => event.type === "session.opened")).toHaveLength(1);
  expect(
    stderr.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("child child-1")),
  ).toEqual([
    "[muse-provider] child child-1: session/read timeout: Muse session/read timed out — retrying on next update\n",
  ]);
});

test("a failed child page keeps its cursor and resumes there on the next update", async () => {
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  let pages = 0;
  const message = childMessage(1);
  const { calls, events, children } = setup((method) => {
    if (method === "session/read") return childSession;
    pages++;
    if (pages === 1)
      return {
        events: [{ method: "item/completed", params: { viewCursor: "v:1", item: message } }],
        nextCursor: null,
      };
    if (pages === 2) throw new MuseError("internal", "boom");
    return { events: [], nextCursor: null };
  });
  await children.update(childItem(1));
  await children.update(childItem(2));
  await children.update(childItem(3));
  expect(
    calls.filter((call) => call.method === "view/page").map((call) => call.params.cursor),
  ).toEqual([undefined, "v:1", "v:1"]);
  expect(
    events.filter((event) => event.type === "timeline.item" && event.sessionId === "child-1"),
  ).toHaveLength(1);
});

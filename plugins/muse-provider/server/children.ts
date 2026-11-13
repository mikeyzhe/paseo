import type { ProviderEvent } from "@getpaseo/plugin/server/provider";
import { MspConnection, type Notification } from "./connection.js";
import { MuseError } from "./errors.js";
import { Timeline } from "./timeline.js";
import {
  childSessionSchema,
  pageSchema,
  itemNotificationSchema,
  notificationSchema,
  deltaSchema,
  type WireItem,
} from "./wire.js";

// Child drill-down reads get a generous budget: Muse can be slow to answer
// while it compacts a large session or spawns workflow children, and a slow
// child read must never kill the parent (2026-11-12 live bug: a default-10s
// session/read timeout escaped into session.runtime_failed and killed the
// parent agent along with its workflow). Every other request keeps its own
// timeout; only the two child reads below pass this value.
const CHILD_READ_TIMEOUT_MS = 60_000;

interface Child {
  timeline: Timeline;
  cursor: string | undefined;
}
interface PendingChild {
  toolCallId: string;
}
export class Children {
  private readonly children = new Map<string, Child>();
  private readonly pending = new Map<string, PendingChild>();
  constructor(
    private readonly host: MspConnection,
    private readonly parentId: string,
    private readonly cwd: string,
    private readonly emit: (event: ProviderEvent) => void,
  ) {}

  async update(item: WireItem): Promise<void> {
    if (!isChildItem(item)) return;
    const id = item.childSessionId;
    if (!this.children.has(id)) {
      const toolCallId = item.callId ?? item.itemId;
      if (!(await this.open(id, toolCallId))) {
        this.pending.set(id, { toolCallId });
        return;
      }
      this.pending.delete(id);
    }
    await this.page(id);
  }
  async notify(id: string, event: Notification): Promise<void> {
    const child = this.children.get(id);
    if (!child) return;
    if (["item/started", "item/updated", "item/completed"].includes(event.method)) {
      const { item } = itemNotificationSchema.parse(event.params);
      await child.timeline.fold(item);
    } else if (event.method === "item/delta") child.timeline.delta(deltaSchema.parse(event.params));
  }
  async refresh(): Promise<void> {
    for (const [id, pending] of this.pending) {
      if (this.children.has(id) || (await this.open(id, pending.toolCallId)))
        this.pending.delete(id);
    }
    for (const id of this.children.keys()) await this.page(id);
  }
  // Best-effort open: any session/read failure (timeout, MuseError,
  // schema/parse error, a closed child) logs one line and retries on the
  // next item for this child or on refresh(). session.opened emits exactly
  // once, guarded by the children map on this serialized chain.
  private async open(id: string, toolCallId: string): Promise<boolean> {
    let session: { workspaceRoot: string | null; title?: string };
    try {
      ({ session } = await this.host.request(
        "session/read",
        { sessionId: id },
        childSessionSchema,
        CHILD_READ_TIMEOUT_MS,
      ));
    } catch (error) {
      process.stderr.write(
        `[muse-provider] child ${id}: session/read ${describe(error)} — retrying on next update\n`,
      );
      return false;
    }
    this.emit({
      type: "session.opened",
      sessionId: id,
      parentSessionId: this.parentId,
      toolCallId,
      capabilities: [],
      restoration: "parent",
      cwd: session.workspaceRoot ?? this.cwd,
      title: session.title,
    });
    this.children.set(id, {
      timeline: new Timeline(this.host, id, id, this.emit),
      cursor: undefined,
    });
    return true;
  }
  // Best-effort paging: a view/page failure logs one line and keeps the
  // cursor, so the next update or refresh resumes where it left off.
  private async page(id: string): Promise<void> {
    const child = this.children.get(id)!;
    let next: string | null;
    do {
      let page: { events: Notification[]; nextCursor: string | null };
      try {
        page = await this.host.request(
          "view/page",
          { sessionId: id, cursor: child.cursor, limit: 1000, direction: "forward" },
          pageSchema,
          CHILD_READ_TIMEOUT_MS,
        );
      } catch (error) {
        process.stderr.write(
          `[muse-provider] child ${id}: view/page ${describe(error)} — resuming from saved cursor\n`,
        );
        return;
      }
      for (const event of page.events) {
        await this.notify(id, event);
        const envelope = notificationSchema.parse(event.params);
        if (envelope.viewCursor) child.cursor = envelope.viewCursor;
      }
      next = page.nextCursor;
      if (next !== null) child.cursor = next;
    } while (next !== null);
  }
  close(): void {
    for (const sessionId of this.children.keys()) this.emit({ type: "session.closed", sessionId });
    this.children.clear();
    this.pending.clear();
  }
}

function isChildItem(item: WireItem): item is WireItem & { childSessionId: string } {
  return (
    !!item.childSessionId &&
    (item.kind === "subagent" ||
      item.kind === "workflow" ||
      item.tool === "workflow" ||
      item.tool.startsWith("subagent_"))
  );
}

function describe(error: unknown): string {
  let kind: string;
  if (error instanceof MuseError) kind = error.kind;
  else if (error instanceof Error) kind = error.name;
  else kind = "error";
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 120);
  return `${kind}: ${message}`;
}

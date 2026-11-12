import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonConnectionError } from "@getpaseo/client/internal/daemon-client";
import { resolveCallerAgentId as resolveRunCallerAgentId } from "../../utils/caller-agent.js";
import {
  resolveExistingRunWorkspace,
  runRunCommand,
  waitsForFinish,
  type AgentRunOptions,
} from "./run";

const daemonTarget = { kind: "endpoint" as const, host: "example.test:12345" };

// Answers fetchAgent the way a daemon does: an unknown id is an error.
function daemonWithAgents(...agentIds: string[]) {
  return {
    async fetchAgent({ agentId }: { agentId: string }) {
      if (!agentIds.includes(agentId)) {
        throw new Error(`Agent not found: ${agentId}`);
      }
      return { agent: { id: agentId } };
    },
  };
}

describe("run wait policy", () => {
  it("waits by default and stops waiting on --no-wait or a legacy alias", () => {
    expect(waitsForFinish({})).toBe(true);
    expect(waitsForFinish({ wait: false })).toBe(false);
    expect(waitsForFinish({ background: true })).toBe(false);
    expect(waitsForFinish({ detach: true })).toBe(false);
  });
});

describe("managed agent caller context", () => {
  it("uses a trimmed PASEO_AGENT_ID when the target daemon runs that agent", async () => {
    await expect(
      resolveRunCallerAgentId(daemonWithAgents("parent-agent"), {
        PASEO_AGENT_ID: "  parent-agent  ",
      }),
    ).resolves.toBe("parent-agent");
  });

  it("runs without a caller when PASEO_AGENT_ID belongs to another daemon", async () => {
    await expect(
      resolveRunCallerAgentId(daemonWithAgents("other-agent"), {
        PASEO_AGENT_ID: "parent-agent",
      }),
    ).resolves.toBeUndefined();
  });

  it.each(["DAEMON_CONNECTION_LOST", "DAEMON_REQUEST_TIMEOUT"] as const)(
    "preserves %s instead of dropping the caller",
    async (code) => {
      const disconnectedDaemon = {
        async fetchAgent(): Promise<never> {
          throw new DaemonConnectionError("Caller lookup transport failed", code);
        },
      };

      await expect(
        resolveRunCallerAgentId(disconnectedDaemon, { PASEO_AGENT_ID: "parent-agent" }),
      ).rejects.toBeInstanceOf(DaemonConnectionError);
    },
  );

  it("omits blank caller ids", async () => {
    await expect(
      resolveRunCallerAgentId(daemonWithAgents(), { PASEO_AGENT_ID: "   " }),
    ).resolves.toBeUndefined();
  });
});

describe("existing run workspace resolution", () => {
  it("queries the daemon for an exact workspace id and uses its directory", async () => {
    const fetchWorkspaces = vi.fn().mockResolvedValue({
      entries: [{ id: "workspace-2", workspaceDirectory: "/workspace/two" }],
      pageInfo: { nextCursor: null },
    });

    await expect(resolveExistingRunWorkspace({ fetchWorkspaces }, "workspace-2")).resolves.toEqual({
      id: "workspace-2",
      cwd: "/workspace/two",
    });
    expect(fetchWorkspaces).toHaveBeenCalledWith({
      filter: { query: "workspace-2" },
      page: { limit: 200 },
    });
  });

  it("rejects a workspace id absent from daemon state", async () => {
    const fetchWorkspaces = vi.fn().mockResolvedValue({
      entries: [],
      pageInfo: { nextCursor: null },
    });

    await expect(resolveExistingRunWorkspace({ fetchWorkspaces }, "missing")).rejects.toMatchObject(
      {
        code: "WORKSPACE_NOT_FOUND",
        message: "Workspace not found: missing",
      },
    );
  });
});

// validateRunOptions runs before the CLI ever connects to a daemon, so these
// invalid combinations reject without one running.
describe("runRunCommand option validation", () => {
  const originalWorkspaceId = process.env.PASEO_WORKSPACE_ID;

  beforeEach(() => {
    delete process.env.PASEO_WORKSPACE_ID;
  });

  afterEach(() => {
    if (originalWorkspaceId === undefined) {
      delete process.env.PASEO_WORKSPACE_ID;
    } else {
      process.env.PASEO_WORKSPACE_ID = originalWorkspaceId;
    }
  });

  async function expectInvalidOptions(
    options: Omit<AgentRunOptions, "daemonTarget">,
    messageMatch: RegExp,
  ) {
    await expect(
      runRunCommand("do something", { ...options, daemonTarget }, {} as never),
    ).rejects.toMatchObject({
      code: "INVALID_OPTIONS",
      message: expect.stringMatching(messageMatch),
    });
  }

  it("rejects --new-workspace combined with --workspace", async () => {
    await expectInvalidOptions(
      { newWorkspace: "worktree", workspace: "ws-1" },
      /--new-workspace and --workspace cannot be combined/,
    );
  });

  it("allows explicit worktree workspace creation through validation", async () => {
    // Explicit workspace creation with no --workspace
    // must clear validation. It still fails later (provider resolution), which
    // is enough to prove the new guard did not reject it.
    await expect(
      runRunCommand(
        "do something",
        { newWorkspace: "worktree", provider: undefined, daemonTarget },
        {} as never,
      ),
    ).rejects.not.toMatchObject({ code: "INVALID_OPTIONS" });
  });

  it("rejects unknown new workspace kinds", async () => {
    await expectInvalidOptions({ newWorkspace: "container" }, /Unsupported new workspace kind/);
  });

  it("rejects two workspace creation flags", async () => {
    await expectInvalidOptions(
      { newWorkspace: "local", worktree: "legacy-slug" },
      /--new-workspace and --worktree cannot be combined/,
    );
  });

  it("rejects an unknown worktree creation mode before connecting", async () => {
    await expectInvalidOptions(
      { newWorkspace: "worktree", worktreeMode: "container" },
      /Unsupported worktree mode/,
    );
  });
});

const runDaemonAgents = new Set<string>();
const runCreateAgent = vi.fn(async () => ({
  id: "agent-1",
  status: "running",
  provider: "codex",
  cwd: "/tmp/project",
  title: null,
}));
const runFetchAgent = vi.fn(async ({ agentId }: { agentId: string }) => {
  if (!runDaemonAgents.has(agentId)) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return { agent: { id: agentId } };
});
const runCreateWorkspace = vi.fn(async () => ({
  workspace: { id: "ws-1", name: "w", workspaceDirectory: "/tmp/project" },
}));
const runClose = vi.fn(async () => undefined);

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(async () => ({
    fetchAgent: runFetchAgent,
    createAgent: runCreateAgent,
    createWorkspace: runCreateWorkspace,
    close: runClose,
  })),
  getDaemonHost: vi.fn(() => "ws://127.0.0.1:6767"),
}));

describe("runRunCommand finish notification", () => {
  const originalAgentId = process.env.PASEO_AGENT_ID;
  const originalWorkspaceId = process.env.PASEO_WORKSPACE_ID;

  beforeEach(() => {
    runDaemonAgents.clear();
    runCreateAgent.mockClear();
    runFetchAgent.mockClear();
    runCreateWorkspace.mockClear();
    runClose.mockClear();
    delete process.env.PASEO_AGENT_ID;
    delete process.env.PASEO_WORKSPACE_ID;
  });

  afterEach(() => {
    if (originalAgentId === undefined) {
      delete process.env.PASEO_AGENT_ID;
    } else {
      process.env.PASEO_AGENT_ID = originalAgentId;
    }
    if (originalWorkspaceId === undefined) {
      delete process.env.PASEO_WORKSPACE_ID;
    } else {
      process.env.PASEO_WORKSPACE_ID = originalWorkspaceId;
    }
  });

  async function runNoWait(options: Omit<AgentRunOptions, "daemonTarget">) {
    return runRunCommand(
      "do something",
      { wait: false, provider: "codex", cwd: "/tmp/project", daemonTarget, ...options },
      {} as never,
    );
  }

  it("passes notifyOnFinish true when the caller resolves on this daemon", async () => {
    process.env.PASEO_AGENT_ID = "parent-agent";
    runDaemonAgents.add("parent-agent");

    await runNoWait({});

    expect(runCreateAgent).toHaveBeenCalledTimes(1);
    expect(runCreateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ callerAgentId: "parent-agent", notifyOnFinish: true }),
    );
  });

  it("passes notifyOnFinish false with --no-notify", async () => {
    process.env.PASEO_AGENT_ID = "parent-agent";
    runDaemonAgents.add("parent-agent");

    await runNoWait({ notify: false });

    expect(runCreateAgent).toHaveBeenCalledTimes(1);
    expect(runCreateAgent).toHaveBeenCalledWith(
      expect.objectContaining({ callerAgentId: "parent-agent", notifyOnFinish: false }),
    );
  });

  it("passes notifyOnFinish false with no caller", async () => {
    await runNoWait({});

    expect(runCreateAgent).toHaveBeenCalledTimes(1);
    expect(runCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ notifyOnFinish: false }));
    expect(runCreateAgent.mock.calls[0]?.[0]?.callerAgentId).toBeUndefined();
  });

  it("passes notifyOnFinish false when PASEO_AGENT_ID belongs to another daemon", async () => {
    process.env.PASEO_AGENT_ID = "foreign-agent";

    await runNoWait({});

    expect(runCreateAgent).toHaveBeenCalledTimes(1);
    expect(runCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ notifyOnFinish: false }));
    expect(runCreateAgent.mock.calls[0]?.[0]?.callerAgentId).toBeUndefined();
  });
});

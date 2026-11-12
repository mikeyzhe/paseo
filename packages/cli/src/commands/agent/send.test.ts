import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSendCommand, type AgentSendOptions } from "./send.js";

const daemonTarget = { kind: "endpoint" as const, host: "example.test:12345" };

const sendDaemonAgents = new Set<string>();
const sendAgentMessage = vi.fn(async () => ({}));
const sendFetchAgent = vi.fn(async ({ agentId }: { agentId: string }) => {
  if (!sendDaemonAgents.has(agentId)) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return { agent: { id: agentId } };
});
const sendClose = vi.fn(async () => undefined);

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(async () => ({
    fetchAgent: sendFetchAgent,
    sendAgentMessage,
    close: sendClose,
  })),
  getDaemonHost: vi.fn(() => "ws://127.0.0.1:6767"),
}));

describe("runSendCommand finish notification", () => {
  const originalAgentId = process.env.PASEO_AGENT_ID;

  beforeEach(() => {
    sendDaemonAgents.clear();
    sendAgentMessage.mockClear();
    sendFetchAgent.mockClear();
    sendClose.mockClear();
    delete process.env.PASEO_AGENT_ID;
  });

  afterEach(() => {
    if (originalAgentId === undefined) {
      delete process.env.PASEO_AGENT_ID;
    } else {
      process.env.PASEO_AGENT_ID = originalAgentId;
    }
  });

  async function sendNoWait(options: Omit<AgentSendOptions, "daemonTarget"> = {}) {
    return runSendCommand(
      "agent-1",
      "do the thing",
      { wait: false, daemonTarget, ...options },
      {} as never,
    );
  }

  it("passes notifyOnFinish true when the caller resolves on this daemon", async () => {
    process.env.PASEO_AGENT_ID = "parent-agent";
    sendDaemonAgents.add("parent-agent");

    await sendNoWait();

    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "agent-1",
      "do the thing",
      expect.objectContaining({ sourceAgentId: "parent-agent", notifyOnFinish: true }),
    );
  });

  it("passes notifyOnFinish false with --no-notify", async () => {
    process.env.PASEO_AGENT_ID = "parent-agent";
    sendDaemonAgents.add("parent-agent");

    await sendNoWait({ notify: false });

    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "agent-1",
      "do the thing",
      expect.objectContaining({ sourceAgentId: "parent-agent", notifyOnFinish: false }),
    );
  });

  it("passes notifyOnFinish false with no caller and skips the caller lookup", async () => {
    await sendNoWait();

    expect(sendFetchAgent).not.toHaveBeenCalled();
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "agent-1",
      "do the thing",
      expect.objectContaining({ notifyOnFinish: false }),
    );
    expect(sendAgentMessage.mock.calls[0]?.[2]?.sourceAgentId).toBeUndefined();
  });

  it("keeps provenance but passes notifyOnFinish false when PASEO_AGENT_ID belongs to another daemon", async () => {
    process.env.PASEO_AGENT_ID = "foreign-agent";

    await sendNoWait();

    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage).toHaveBeenCalledWith(
      "agent-1",
      "do the thing",
      expect.objectContaining({ sourceAgentId: "foreign-agent", notifyOnFinish: false }),
    );
  });
});

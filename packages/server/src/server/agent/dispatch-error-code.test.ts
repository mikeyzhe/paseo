import { describe, expect, it } from "vitest";
import {
  TURN_ACTIVE_MESSAGE,
  TurnActiveError,
  sendAgentMessageErrorCode,
} from "./dispatch-error-code.js";
import { StaleProviderSessionError } from "./stale-provider-session-error.js";

describe("TurnActiveError", () => {
  it("keeps the established busy message and carries code turn_active", () => {
    const error = new TurnActiveError();
    expect(error.message).toBe("A foreground turn is already active");
    expect(error.message).toBe(TURN_ACTIVE_MESSAGE);
    expect(error.code).toBe("turn_active");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("sendAgentMessageErrorCode", () => {
  it("maps the provider busy guard to turn_active", () => {
    expect(sendAgentMessageErrorCode(new TurnActiveError())).toBe("turn_active");
  });

  it("maps agent-missing failures to agent_missing", () => {
    expect(sendAgentMessageErrorCode(new Error("Agent not found: abc123"))).toBe("agent_missing");
    expect(sendAgentMessageErrorCode(new Error("Agent abc123 not found"))).toBe("agent_missing");
    expect(
      sendAgentMessageErrorCode(new Error("Agent abc123 not found in storage after snapshot")),
    ).toBe("agent_missing");
    expect(sendAgentMessageErrorCode("agent_not_found")).toBe("agent_missing");
  });

  it("maps a stale provider session to stale_session", () => {
    expect(sendAgentMessageErrorCode(new StaleProviderSessionError("session-1"))).toBe(
      "stale_session",
    );
  });

  it("returns null for errors without a code", () => {
    expect(sendAgentMessageErrorCode(new Error("agent_request_key_conflict"))).toBeNull();
    expect(sendAgentMessageErrorCode(new Error("boom"))).toBeNull();
    expect(sendAgentMessageErrorCode("boom")).toBeNull();
    expect(sendAgentMessageErrorCode(null)).toBeNull();
    expect(sendAgentMessageErrorCode(undefined)).toBeNull();
  });
});

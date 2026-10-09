import type { SendAgentMessageErrorCode } from "@getpaseo/protocol/messages";
import { isStaleProviderSessionError } from "./stale-provider-session-error.js";

/** Unchanged busy-guard text every provider throws; the code travels alongside it. */
export const TURN_ACTIVE_MESSAGE = "A foreground turn is already active";

/** Provider busy guard: same message as before, now carrying code "turn_active". */
export class TurnActiveError extends Error {
  readonly code = "turn_active" as const;

  constructor(message: string = TURN_ACTIVE_MESSAGE) {
    super(message);
    this.name = "TurnActiveError";
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set(["turn_active", "agent_missing", "stale_session"]);

const AGENT_NOT_FOUND_PATTERN = /agent_not_found|agent\b.*\bnot found/i;

/**
 * Maps a send failure to the structured `code` on send_agent_message_response.
 * Returns null when the error has no code (callers omit the field).
 */
export function sendAgentMessageErrorCode(error: unknown): SendAgentMessageErrorCode | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && KNOWN_CODES.has(code)) {
      return code as SendAgentMessageErrorCode;
    }
  }
  if (isStaleProviderSessionError(error)) {
    return "stale_session";
  }
  let message: string | null = null;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  }
  if (message && AGENT_NOT_FOUND_PATTERN.test(message)) {
    return "agent_missing";
  }
  return null;
}

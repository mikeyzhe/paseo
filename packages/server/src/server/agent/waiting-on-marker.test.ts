import { describe, expect, it } from "vitest";

import { parseWaitingOnMarker } from "./waiting-on-marker.js";

describe("parseWaitingOnMarker", () => {
  it("parses comma-separated agent ids from a standalone marker line", () => {
    expect(
      parseWaitingOnMarker("Pausing here.\n@@waiting_on: agent-123, @reviewer\nBack soon."),
    ).toEqual({ found: true, waitingOn: ["agent-123", "@reviewer"] });
  });

  it("deduplicates agent ids while preserving order", () => {
    expect(parseWaitingOnMarker("@@waiting_on: @agent, ag_2, @agent")).toEqual({
      found: true,
      waitingOn: ["@agent", "ag_2"],
    });
  });

  it("clears standby when the marker is none", () => {
    expect(parseWaitingOnMarker("@@waiting_on: none")).toEqual({
      found: true,
      waitingOn: [],
    });
  });

  it("ignores inline or malformed markers", () => {
    expect(parseWaitingOnMarker("text @@waiting_on: ag_1")).toEqual({ found: false });
    expect(parseWaitingOnMarker("@@waiting_on")).toEqual({ found: false });
  });
});

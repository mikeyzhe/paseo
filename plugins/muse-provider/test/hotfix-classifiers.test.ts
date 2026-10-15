import { expect, test } from "vitest";
import { isMuseRuntimeFault } from "../server/errors.js";

test("isMuseRuntimeFault matches per-process session poisoning", () => {
  expect(isMuseRuntimeFault("event log failed: Origin read requires valid checkpoint-suffix")).toBe(
    true,
  );
  expect(isMuseRuntimeFault("event log failed: event id 7 conflicts with an existing event")).toBe(
    true,
  );
  expect(isMuseRuntimeFault("invalid run configuration: MCP startup audit failed")).toBe(true);
  // Case-insensitive; other failures are not runtime faults.
  expect(isMuseRuntimeFault("Event Log Failed: wedged")).toBe(true);
  expect(isMuseRuntimeFault("overloaded: busy")).toBe(false);
  expect(isMuseRuntimeFault("authentication expired")).toBe(false);
  expect(isMuseRuntimeFault("")).toBe(false);
});

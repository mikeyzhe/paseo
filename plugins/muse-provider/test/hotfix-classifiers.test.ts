import { expect, test } from "vitest";
import { isMuseRuntimeFault } from "../server/errors.js";
import { catalogSchema } from "../server/wire.js";

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

test("catalogSchema normalizes object-form reasoning effort variants to tiers", () => {
  const parsed = catalogSchema.parse({
    models: [
      {
        modelId: "m",
        providerId: "meta",
        displayLabel: "M",
        contextLimit: null,
        isDefault: true,
        variants: [{ tier: "xhigh", description: "deep" }, "low"],
      },
    ],
  });
  expect(parsed.models[0].variants).toEqual(["xhigh", "low"]);
});

test("catalogSchema still accepts string variants and unknown", () => {
  const parsed = catalogSchema.parse({
    models: [
      {
        modelId: "m",
        providerId: "meta",
        displayLabel: "M",
        contextLimit: null,
        isDefault: true,
        variants: ["low"],
      },
    ],
  });
  expect(parsed.models[0].variants).toEqual(["low"]);
  const unknowned = catalogSchema.parse({
    models: [
      {
        modelId: "m",
        providerId: "meta",
        displayLabel: "M",
        contextLimit: null,
        isDefault: true,
        variants: "unknown",
      },
    ],
  });
  expect(unknowned.models[0].variants).toEqual([]);
});

import { expect, test } from "vitest";
import { serveArgs, withServeModel } from "../server/options.js";

test("serveArgs pins the host default to the requested model", () => {
  expect(serveArgs({}, "muse-spark-1.3-contributor")).toEqual([
    "--sandbox-network",
    "proxy-only",
    "--disable-sandbox",
    "--trust-workspace",
    "--model",
    "muse-spark-1.3-contributor",
  ]);
});

test("serveArgs omits --model when no model is requested", () => {
  expect(serveArgs({})).toEqual([
    "--sandbox-network",
    "proxy-only",
    "--disable-sandbox",
    "--trust-workspace",
  ]);
  expect(serveArgs({}, "")).not.toContain("--model");
});

test("withServeModel replaces a stale --model pair", () => {
  expect(
    withServeModel(["--disable-sandbox", "--model", "muse-wonder-1.0"], "muse-spark-1.3"),
  ).toEqual(["--disable-sandbox", "--model", "muse-spark-1.3"]);
});

test("withServeModel appends --model when absent and never mutates", () => {
  const base = ["--disable-sandbox"];
  expect(withServeModel(base, "muse-spark-1.3")).toEqual([
    "--disable-sandbox",
    "--model",
    "muse-spark-1.3",
  ]);
  expect(base).toEqual(["--disable-sandbox"]);
});

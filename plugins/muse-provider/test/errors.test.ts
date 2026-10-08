import { expect, test } from "vitest";
import type { ProviderLaunch } from "@getpaseo/plugin/server/provider";
import { actionableError, MuseError } from "../server/errors.js";

const launch: ProviderLaunch = { command: "muse", args: [], env: {} };

test("a locked Keychain names the Keychain instead of the raw security error", () => {
  expect(
    actionableError(
      new Error("security: SecKeychainFindGenericPassword: User interaction is not allowed."),
      launch,
    ),
  ).toEqual({
    code: "keychainLocked",
    message:
      "Muse credentials are unreadable (macOS Keychain locked). Unlock the Keychain or run `muse login`.",
    diagnostic: "security: SecKeychainFindGenericPassword: User interaction is not allowed.",
  });
});

test("a Keychain failure wrapped as a MuseError still names the Keychain", () => {
  expect(
    actionableError(new MuseError("internal", "keychain lookup failed: exit 36"), launch),
  ).toMatchObject({
    code: "keychainLocked",
    message: expect.stringContaining("macOS Keychain locked"),
  });
});

test("non-Keychain errors are unchanged", () => {
  expect(actionableError(new MuseError("authRequired", "expired"), launch)).toEqual({
    code: "authRequired",
    message: "Run `muse login` or set META_API_KEY.",
  });
  expect(actionableError(new Error("boom"), launch)).toEqual({ code: "muse", message: "boom" });
});

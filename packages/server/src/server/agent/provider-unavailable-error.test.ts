import { describe, expect, test } from "vitest";

import {
  classifyProviderProbeError,
  classifyProviderUnavailable,
  createProviderUnavailableError,
  formatProviderUnavailableMessage,
} from "./provider-unavailable-error.js";

describe("classifyProviderUnavailable", () => {
  test("maps a missing binary to not_installed", () => {
    expect(classifyProviderUnavailable("muse not found on PATH")).toBe("not_installed");
    expect(classifyProviderUnavailable("Install Muse Code and ensure `muse` is on PATH.")).toBe(
      "not_installed",
    );
    expect(classifyProviderUnavailable("spawn /missing/muse ENOENT")).toBe("not_installed");
  });

  test("maps sign-in and credential failures to auth", () => {
    expect(classifyProviderUnavailable("Run `muse login` or set META_API_KEY")).toBe("auth");
    expect(
      classifyProviderUnavailable(
        "Muse credentials are unreadable (macOS Keychain locked). Unlock the Keychain or run `muse login`.",
      ),
    ).toBe("auth");
    expect(classifyProviderUnavailable("security: User interaction is not allowed.")).toBe("auth");
  });

  test("maps probe timeouts to probe_error", () => {
    expect(
      classifyProviderUnavailable("Timed out collecting 'muse' diagnostic after 10000ms"),
    ).toBe("probe_error");
    expect(classifyProviderUnavailable("connect ECONNREFUSED 127.0.0.1:6767")).toBe("probe_error");
  });

  test("leaves unmatched diagnostics unavailable", () => {
    expect(classifyProviderUnavailable("Update Muse Code: found 1.2.9, need ≥1.3.0")).toBe(
      "unavailable",
    );
    expect(classifyProviderUnavailable("Muse returned an unrecognized version.")).toBe(
      "unavailable",
    );
    expect(classifyProviderUnavailable(null)).toBe("unavailable");
    expect(classifyProviderUnavailable("   ")).toBe("unavailable");
  });
});

describe("classifyProviderProbeError", () => {
  test("keeps definite signals, defaults the rest to transient probe_error", () => {
    expect(classifyProviderProbeError("muse not found on PATH")).toBe("not_installed");
    expect(classifyProviderProbeError("Not authenticated")).toBe("auth");
    expect(classifyProviderProbeError("Timed out after 5000ms")).toBe("probe_error");
    expect(classifyProviderProbeError("socket hang up")).toBe("probe_error");
    expect(classifyProviderProbeError("something inexplicable happened")).toBe("probe_error");
  });
});

describe("formatProviderUnavailableMessage", () => {
  test("carries the machine code and the provider diagnostic on one line", () => {
    expect(
      formatProviderUnavailableMessage("muse", "auth", "Run `muse login` or set META_API_KEY"),
    ).toBe(
      "Provider 'muse' is not available [provider_unavailable:auth]: Run `muse login` or set META_API_KEY",
    );
  });

  test("collapses multi-line diagnostics to one line", () => {
    const message = formatProviderUnavailableMessage("muse", "unavailable", "Muse\n  Binary: x\n");
    expect(message).toBe(
      "Provider 'muse' is not available [provider_unavailable:unavailable]: Muse Binary: x",
    );
    expect(message).not.toContain("\n");
  });

  test("falls back per reason when no diagnostic is available", () => {
    expect(formatProviderUnavailableMessage("muse", "disabled", null)).toBe(
      "Provider 'muse' is not available [provider_unavailable:disabled]: Provider 'muse' is disabled.",
    );
    expect(formatProviderUnavailableMessage("muse", "probe_error", "")).toBe(
      "Provider 'muse' is not available [provider_unavailable:probe_error]: The availability probe failed; retry.",
    );
  });
});

describe("createProviderUnavailableError", () => {
  test("sets the stable machine code on the error", () => {
    const error = createProviderUnavailableError("muse", "auth", "Run `muse login`");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("provider_unavailable:auth");
    expect(error.message).toContain("[provider_unavailable:auth]");
  });
});

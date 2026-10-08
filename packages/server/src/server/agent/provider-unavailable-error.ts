import type { AgentProvider } from "./agent-sdk-types.js";

// Machine code prefix for provider-unavailable failures. The full code is
// `provider_unavailable:<reason>`; it travels inside the error message because
// the daemon's rpc_error envelope only forwards message text to API clients.
export const PROVIDER_UNAVAILABLE_CODE = "provider_unavailable";

export type ProviderUnavailableReason =
  | "not_installed"
  | "auth"
  | "probe_error"
  | "disabled"
  | "unavailable";

// Bound for re-running the provider diagnostic on the failure path. The
// availability probe just ran, so this second call should be fast; the timeout
// keeps a wedged diagnostic from hanging resume/create.
export const PROVIDER_UNAVAILABLE_DIAGNOSTIC_TIMEOUT_MS = 10_000;

const DISABLED_PATTERNS = [/is disabled/i, /disabled in config/i];

const NOT_INSTALLED_PATTERNS = [
  /not found on PATH/i,
  /not installed/i,
  /ensure .* on PATH/i,
  /command not found/i,
  /no such file/i,
  /ENOENT/,
  /not recognized as an internal or external command/i,
];

const AUTH_PATTERNS = [
  /\blogin\b/i,
  /\blogged out\b/i,
  /signed in/i,
  /signed out/i,
  /not authenticated/i,
  /authentication (failed|expired|required)/i,
  /\bauth\b/i,
  /META_API_KEY/,
  /API key/i,
  /credential/i,
  /keychain/i,
  /user interaction is not allowed/i,
  /interaction not allowed/i,
];

const PROBE_ERROR_PATTERNS = [
  /timed out/i,
  /timeout/i,
  /timing out/i,
  /ETIMEDOUT/,
  /ECONNREFUSED/,
  /ECONNRESET/,
  /EAI_AGAIN/,
  /socket hang up/i,
  /temporarily/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

// Classify a diagnostic string returned by the provider's own status probe
// (the same source `paseo provider diagnostic` prints). Unmatched text stays
// "unavailable": the detail carries the meaning, the reason stays honest.
export function classifyProviderUnavailable(
  diagnostic: string | null | undefined,
): ProviderUnavailableReason {
  if (!diagnostic || diagnostic.trim().length === 0) {
    return "unavailable";
  }
  if (matchesAny(diagnostic, DISABLED_PATTERNS)) {
    return "disabled";
  }
  if (matchesAny(diagnostic, NOT_INSTALLED_PATTERNS)) {
    return "not_installed";
  }
  if (matchesAny(diagnostic, AUTH_PATTERNS)) {
    return "auth";
  }
  if (matchesAny(diagnostic, PROBE_ERROR_PATTERNS)) {
    return "probe_error";
  }
  return "unavailable";
}

// Classify an error thrown by the availability probe itself. Unlike a
// returned diagnostic, a throw means the probe never completed, so unmatched
// text is transient ("probe_error": say retry) rather than unknown.
export function classifyProviderProbeError(message: string): ProviderUnavailableReason {
  if (matchesAny(message, DISABLED_PATTERNS)) {
    return "disabled";
  }
  if (matchesAny(message, NOT_INSTALLED_PATTERNS)) {
    return "not_installed";
  }
  if (matchesAny(message, AUTH_PATTERNS)) {
    return "auth";
  }
  return "probe_error";
}

const DETAIL_LINE_CAP = 1000;

export function toProviderUnavailableDetailLine(detail: string): string {
  const collapsed = detail.replace(/\s+/g, " ").trim();
  if (collapsed.length <= DETAIL_LINE_CAP) {
    return collapsed;
  }
  return `${collapsed.slice(0, DETAIL_LINE_CAP)}…(truncated)`;
}

function fallbackDetail(provider: AgentProvider, reason: ProviderUnavailableReason): string {
  switch (reason) {
    case "not_installed":
      return `Install the '${provider}' CLI and ensure it is on PATH.`;
    case "auth":
      return `Sign in (run \`${provider} login\`) or configure credentials.`;
    case "probe_error":
      return "The availability probe failed; retry.";
    case "disabled":
      return `Provider '${provider}' is disabled.`;
    case "unavailable":
      return "No diagnostic available.";
  }
}

export function formatProviderUnavailableMessage(
  provider: AgentProvider,
  reason: ProviderUnavailableReason,
  detail: string | null | undefined,
): string {
  const text =
    detail && detail.trim().length > 0
      ? toProviderUnavailableDetailLine(detail)
      : fallbackDetail(provider, reason);
  return `Provider '${provider}' is not available [${PROVIDER_UNAVAILABLE_CODE}:${reason}]: ${text}`;
}

export type ProviderUnavailableError = Error & { code: string };

export function createProviderUnavailableError(
  provider: AgentProvider,
  reason: ProviderUnavailableReason,
  detail: string | null | undefined,
): ProviderUnavailableError {
  return Object.assign(new Error(formatProviderUnavailableMessage(provider, reason, detail)), {
    code: `${PROVIDER_UNAVAILABLE_CODE}:${reason}`,
  });
}

import { z } from "zod";
import { MuseError } from "./errors.js";

const optionsSchema = z
  .object({
    sandbox: z
      .object({
        enabled: z.boolean().default(false),
        network: z.enum(["proxy-only", "restricted", "enabled"]).default("proxy-only"),
      })
      .strict()
      .prefault({}),
    trustWorkspace: z.boolean().default(true),
  })
  .strict();

export function serveArgs(providerOptions: unknown, model?: string): string[] {
  const parsed = optionsSchema.safeParse(providerOptions === undefined ? {} : providerOptions);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((issue) => `${["providerOptions", ...issue.path].join(".")}: ${issue.message}`)
      .join("; ");
    throw new MuseError("invalidProviderOptions", `Invalid Muse providerOptions: ${errors}`);
  }
  const { sandbox, trustWorkspace } = parsed.data;
  const args = [
    "--sandbox-network",
    sandbox.network,
    ...(sandbox.enabled ? [] : ["--disable-sandbox"]),
    ...(trustWorkspace ? ["--trust-workspace"] : []),
  ];
  // Pin the host default to the session's requested model. Without --model,
  // `muse serve` boots with the provider default (muse-wonder-1.0) and every
  // (re)attach re-stamps runtime.session.metadata with it — so spark sessions
  // report runtime wonder after any resume/recovery cycle.
  if (model) args.push("--model", model);
  return args;
}

// Rebuild serve args after a session/setModel switch so the NEXT host spawn
// (fault recovery, daemon restart) boots with the new model. Replaces a stale
// --model pair instead of appending a second one; never mutates its input.
export function withServeModel(baseArgs: readonly string[], model: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < baseArgs.length; i++) {
    if (baseArgs[i] === "--model") {
      i++;
      continue;
    }
    out.push(baseArgs[i]!);
  }
  out.push("--model", model);
  return out;
}

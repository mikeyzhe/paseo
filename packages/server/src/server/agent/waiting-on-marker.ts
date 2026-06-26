export interface WaitingOnMarkerResult {
  found: boolean;
  waitingOn?: string[];
}

export function parseWaitingOnMarker(text: string): WaitingOnMarkerResult {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("@@waiting_on:")) {
      continue;
    }
    const value = line.slice("@@waiting_on:".length).trim();
    if (value.length === 0 || value.toLowerCase() === "none") {
      return { found: true, waitingOn: [] };
    }
    const seen = new Set<string>();
    const waitingOn: string[] = [];
    for (const part of value.split(",")) {
      const token = part.trim();
      if (token.length === 0 || seen.has(token)) {
        continue;
      }
      seen.add(token);
      waitingOn.push(token);
    }
    return { found: true, waitingOn };
  }
  return { found: false };
}

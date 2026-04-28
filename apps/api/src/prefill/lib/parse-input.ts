/**
 * Extracts the first valid JSON object from raw input that may contain
 * trailing junk — a second JSON object, a stray "{", whitespace, etc.
 *
 * Examples of input the users paste:
 *   {"sparte":"Kfz","prefillData":{...},"userId":"..."}  {"url":"http://...","trace_id":"..."}
 *   {"sparte":"Wg","prefillData":{...},"userId":"..."}  {
 */
export function extractFirstJson(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    throw new Error("Input does not start with a JSON object");
  }

  // Try parsing the whole thing first — fast path for clean input
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Input has trailing data — find where the first object ends
  }

  // Walk through tracking brace depth, respecting strings
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        // Found the end of the first top-level object
        return trimmed.slice(0, i + 1);
      }
    }
  }

  throw new Error("Unterminated JSON object");
}

/**
 * Parses raw input into a clean prefill data object:
 * 1. Extracts first JSON object (strips trailing junk)
 * 2. Unwraps "prefillData" wrapper if present
 */
export function parseAndUnwrap(raw: string): Record<string, unknown> {
  const json = extractFirstJson(raw);
  let data: Record<string, unknown> = JSON.parse(json);

  if (data.prefillData && typeof data.prefillData === "object" && !Array.isArray(data.prefillData)) {
    const unwrapped = data.prefillData as Record<string, unknown>;
    if (data.sparte && !unwrapped.sparte) {
      unwrapped.sparte = data.sparte;
    }
    data = unwrapped;
  }

  return data;
}

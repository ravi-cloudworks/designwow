import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';

const suggest = new Hono<{ Bindings: Bindings }>();

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
};

type FieldDef = { key: string; label?: string; type: string; options?: string[] };
type AutoPopulateField = { key: string; shape: string; createsItemsIn?: { stage: number; itemKey: string } };
type ItemConfig = {
  label?: string;
  content: {
    geminiInstruction?: string;
    fieldsSchema: FieldDef[];
    autoPopulate?: { geminiResponseFields: AutoPopulateField[] };
    ruleOnly?: boolean;
  };
};
type StageConfig = {
  stage: number;
  items: Record<string, ItemConfig>;
};

const MODEL = 'gemini-3.5-flash';
const GEMINI_TIMEOUT_MS = 45000;

type GeminiCallResult =
  | { ok: true; geminiJson: GeminiResponse }
  | { ok: false; kind: 'timeout' | 'network'; detail: string }
  | { ok: false; kind: 'http'; status: number; detail: string };

async function callGeminiOnce(apiKey: string, requestBody: unknown): Promise<GeminiCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, kind: 'http', status: res.status, detail: await res.text() };
    return { ok: true, geminiJson: await res.json<GeminiResponse>() };
  } catch (e) {
    const isAbort = e instanceof Error && e.name === 'AbortError';
    return { ok: false, kind: isAbort ? 'timeout' : 'network', detail: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// A hung/slow Gemini call used to just spin the button forever with no
// timeout and no error — this bounds every call to 45s and retries once,
// but only for failures that are plausibly transient (timeout, network
// blip, Gemini 5xx, or a candidate with no text at all). A content problem
// (invalid JSON, SAFETY filter) is never retried here — a second call won't
// fix bad input, and the caller already has distinct handling for those.
async function callGeminiWithRetry(apiKey: string, requestBody: unknown): Promise<{ result: GeminiCallResult; retried: boolean }> {
  const first = await callGeminiOnce(apiKey, requestBody);
  const transientFailure = !first.ok && (first.kind === 'timeout' || first.kind === 'network' || (first.kind === 'http' && first.status >= 500));
  const emptyText = first.ok && !first.geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (transientFailure || emptyText) {
    return { result: await callGeminiOnce(apiKey, requestBody), retried: true };
  }
  return { result: first, retried: false };
}

// Gemini occasionally wraps JSON in a markdown code fence despite being told
// not to — strip it before parsing.
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return m ? m[1] : trimmed;
}

// Repairs the common ways an LLM's JSON output fails strict parsing even
// though it reads fine to a human: a raw unescaped newline/tab inside a
// string value (illegal — must be \n), an escape sequence that isn't one of
// JSON's legal ones (e.g. \' — only \" \\ \/ \b \f \n \r \t \u are legal),
// and a trailing comma before a closing } or ]. Walks the text tracking
// whether it's inside a string so it never touches structural JSON syntax,
// only string contents — a no-op on already-valid JSON.
function repairJsonText(text: string): string {
  const stripped = stripCodeFences(text);
  const validEscapes = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inString) {
      if (escaped) {
        out += validEscapes.has(ch) ? `\\${ch}` : ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { out += ch; inString = false; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

// Some Gemini responses are otherwise well-formed JSON but have trailing
// junk after the object closes (e.g. a stray extra `}`) — JSON.parse rejects
// the whole thing even though the actual object is fine. Finds the first
// top-level `{...}` by tracking brace depth (skipping braces inside strings)
// and returns just that slice, discarding anything after it.
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Last-resort repair for a response that's genuinely truncated (Gemini
// stopped generating mid-object, for whatever reason) — closes off any
// still-open string and any still-open braces so the object at least
// parses. Returns null if the text isn't actually left open (nothing to
// close), so callers can tell "not this kind of problem" from "repaired".
function forceCloseJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
  }
  if (depth <= 0 && !inString) return null;
  let out = text.slice(start);
  if (inString) out += '"';
  out += '}'.repeat(Math.max(depth, 0));
  return out;
}

// autoPopulate array entries are always {name, <secondary keys...>} — the
// secondary keys vary per field (character/property/background/sound use
// just "description", scenes use several structured fields like
// location/action/dialogue/emotion), read straight out of the shape string
// in the config rather than hardcoded.
function extractSecondaryKeys(shape: string): string[] {
  const m = shape.match(/\{name,\s*([^}]+)\}/);
  if (!m) return ['description'];
  return m[1]
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

function sanitizeAutoPopulateEntries(raw: unknown, secondaryKeys: string[]): Record<string, string>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, string>[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const name = typeof (entry as Record<string, unknown>).name === 'string' ? ((entry as Record<string, unknown>).name as string).trim() : '';
    if (!name) continue;
    const cleaned: Record<string, string> = { name };
    for (const key of secondaryKeys) {
      const val = (entry as Record<string, unknown>)[key];
      cleaned[key] = typeof val === 'string' ? val.trim() : '';
    }
    out.push(cleaned);
  }
  return out;
}


// The one surviving Gemini call in the whole app (per-item Setup+prompt
// generation was removed — designers upload their own reference images and
// write Scene/Movie content directly now). This takes whatever text is
// currently in the Story prompt — AI-written or hand-edited, doesn't matter —
// and asks Gemini specifically to extract the auto-populate arrays from it,
// callable any time, not tied to a generation.
suggest.post('/auto-populate', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const body = await c.req.json<{ stage?: number; itemKey?: string; sourceText?: string; fields?: string[] }>().catch(
    () => ({}) as { stage?: number; itemKey?: string; sourceText?: string; fields?: string[] }
  );
  const stage = body.stage;
  const itemKey = body.itemKey || '';
  const sourceText = (body.sourceText || '').trim();
  if (!stage || !itemKey) return c.json({ error: 'stage_and_itemKey_required' }, 400);
  if (!sourceText) return c.json({ error: 'source_text_required' }, 400);
  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'gemini_not_configured' }, 500);

  const row = await c.env.DB.prepare('SELECT config FROM stage_prompts WHERE stage = ?').bind(stage).first<{ config: string }>();
  if (!row) return c.json({ error: 'unknown_stage' }, 400);
  const stageConfig = JSON.parse(row.config) as StageConfig;
  const itemConfig = stageConfig.items[itemKey];
  if (!itemConfig) return c.json({ error: 'unknown_item_key' }, 400);
  // Callers can ask for a subset (e.g. Stage 3's sync wants everything
  // except scenes — scenes reference Characters/Properties/Backgrounds by
  // name, so syncing them before those are finalized risks the same
  // "created from data that might change" problem this whole feature exists
  // to avoid; scenes get their own sync, later, once Stage 3 is settled).
  let autoPopulateFields = itemConfig.content.autoPopulate?.geminiResponseFields || [];
  if (body.fields && body.fields.length) {
    autoPopulateFields = autoPopulateFields.filter((f) => body.fields!.includes(f.key));
  }
  if (!autoPopulateFields.length) return c.json({ error: 'no_autopopulate_configured' }, 400);

  const autoPopulateDescriptions = autoPopulateFields
    .map((f) => `"${f.key}": ${f.shape} — omit or leave an empty array if none apply`)
    .join('\n');

  const prompt = `You are helping a UGC video ad designer keep Stage 3 (Characters/Properties/Backgrounds/Sounds) in sync with the current story text below — the story may have just been hand-edited after customer feedback, so extract fresh, not from memory.

Story text:
"""
${sourceText}
"""

Return a JSON object with exactly these fields:
${autoPopulateDescriptions}

Respond with ONLY the JSON object. No markdown, no code fences, no explanation. The response must be strictly valid JSON: escape every double-quote (\\"), backslash (\\\\), and line break (\\n) that appears inside a string value, never use an invalid escape like \\', and never leave a trailing comma before a closing } or ]. Avoid using double quotes (") inside any field's text at all — if you need to quote a name, phrase, or brand, use single quotes (') instead, since a stray unescaped double quote breaks the JSON.`;

  const requestedAt = new Date().toISOString();
  const debugBase: { model: string; requestedAt: string; requestPrompt: string; retried?: boolean } = { model: MODEL, requestedAt, requestPrompt: prompt };

  const { result: geminiResult, retried } = await callGeminiWithRetry(c.env.GEMINI_API_KEY, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.5, maxOutputTokens: 16384 },
  });
  debugBase.retried = retried;

  if (!geminiResult.ok) {
    if (geminiResult.kind === 'timeout') {
      return c.json(
        {
          error: 'gemini_timeout',
          message: `Gemini didn't respond within ${GEMINI_TIMEOUT_MS / 1000}s, even after retrying — try again.`,
          debug: { ...debugBase, rawResponse: geminiResult.detail },
        },
        504
      );
    }
    return c.json({ error: 'gemini_error', detail: geminiResult.detail, debug: { ...debugBase, rawResponse: geminiResult.detail } }, 502);
  }

  const geminiJson = geminiResult.geminiJson;
  const text = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
  const finishReason = geminiJson.candidates?.[0]?.finishReason;
  if (!text) {
    return c.json(
      {
        error: 'gemini_empty_response',
        message: retried ? 'Gemini returned an empty response twice in a row — try again.' : undefined,
        debug: { ...debugBase, rawResponse: JSON.stringify(geminiJson), finishReason },
      },
      502
    );
  }
  if (finishReason === 'MAX_TOKENS') {
    return c.json(
      { error: 'gemini_truncated', message: 'The AI response was cut off before it finished.', debug: { ...debugBase, rawResponse: text, finishReason } },
      502
    );
  }
  if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
    return c.json(
      {
        error: 'gemini_filtered',
        message: `Gemini declined to finish this response (reason: ${finishReason}) — likely a content filter, not a length issue. Try rewording the input.`,
        debug: { ...debugBase, rawResponse: text, finishReason },
      },
      502
    );
  }

  let parsed: Record<string, unknown> | undefined;
  let truncatedRepair = false;
  try {
    parsed = JSON.parse(text);
  } catch {
    try {
      parsed = JSON.parse(repairJsonText(text));
    } catch {
      try {
        const extracted = extractFirstJsonObject(repairJsonText(text));
        if (!extracted) throw new Error('no complete JSON object found in response');
        parsed = JSON.parse(extracted);
      } catch (e3) {
        try {
          const closed = forceCloseJson(repairJsonText(text));
          if (!closed) throw e3;
          parsed = JSON.parse(closed);
          truncatedRepair = true;
        } catch {
          const parseError = e3 instanceof Error ? e3.message : String(e3);
          return c.json(
            {
              error: 'gemini_invalid_json',
              message: `Gemini's response wasn't valid JSON even after repair: ${parseError}`,
              raw: text,
              debug: { ...debugBase, rawResponse: text, parseError, finishReason },
            },
            502
          );
        }
      }
    }
  }
  if (!parsed) return c.json({ error: 'gemini_invalid_json', message: 'Unexpected empty parse result.', debug: { ...debugBase, rawResponse: text, finishReason } }, 502);

  const autoPopulate: Record<string, Record<string, string>[]> = {};
  for (const f of autoPopulateFields) {
    autoPopulate[f.key] = sanitizeAutoPopulateEntries(parsed[f.key], extractSecondaryKeys(f.shape));
  }

  return c.json({
    autoPopulate,
    warning: truncatedRepair ? 'Gemini\'s response was cut off and auto-repaired — review the results carefully before confirming.' : undefined,
    debug: { ...debugBase, rawResponse: text, finishReason },
  });
});

export default suggest;

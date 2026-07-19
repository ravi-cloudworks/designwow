import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';

const suggest = new Hono<{ Bindings: Bindings }>();

type SuggestBody = {
  itemKey?: string;
  stage?: number;
  currentFields?: Record<string, unknown>;
  brief?: Record<string, unknown>;
  attachedFileNames?: string[];
  featuredItems?: { name?: string; summary?: string }[];
};

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

function describeField(f: { key: string; type: string; options?: string[] }): string {
  if (f.options) return `"${f.key}": one of [${f.options.map((o) => `"${o}"`).join(', ')}]`;
  if (f.type === 'number') return `"${f.key}": a number`;
  if (f.type === 'checkbox') return `"${f.key}": true or false`;
  if (f.type === 'list') return `"${f.key}": an array of 2-3 short strings`;
  return `"${f.key}": a short, specific string — not a placeholder`;
}

// project_id/updated_at are pure record-keeping, not creative content; logo_media/
// product_photos are asset references, not text Gemini can use. Stripping them
// keeps the prompt focused and shorter (cheaper) without losing anything useful.
const BRIEF_NOISE_KEYS = new Set(['project_id', 'updated_at', 'logo_media', 'product_photos']);
function cleanBrief(brief: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!brief) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(brief)) {
    const v = brief[k];
    if (BRIEF_NOISE_KEYS.has(k) || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

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

suggest.post('/suggest', async (c) => {
  // Every other route checks this before doing real work — this one was
  // missing it, which meant the Gemini call could be triggered by anyone
  // with the URL, not just a logged-in designer through the app.
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const body = await c.req.json<SuggestBody>().catch(() => ({}) as SuggestBody);
  const itemKey = body.itemKey || '';
  const stage = body.stage;
  if (!stage) return c.json({ error: 'stage_required' }, 400);

  // Field schema, Gemini instruction, auto-populate spec — all sourced from
  // D1, not code. Editing that row changes this without a redeploy.
  const row = await c.env.DB.prepare('SELECT config FROM stage_prompts WHERE stage = ?').bind(stage).first<{ config: string }>();
  if (!row) return c.json({ error: 'unknown_stage' }, 400);
  const stageConfig = JSON.parse(row.config) as StageConfig;
  const itemConfig = stageConfig.items[itemKey];
  if (!itemConfig) return c.json({ error: 'unknown_item_key' }, 400);
  if (itemConfig.content.ruleOnly) {
    return c.json({ error: 'rule_only_item', message: 'This field is set by the designer directly, not AI-suggested.' }, 400);
  }
  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'gemini_not_configured' }, 500);

  const schema = itemConfig.content.fieldsSchema;
  const fieldDescriptions = schema.map(describeField).join('\n');
  const autoPopulateFields = itemConfig.content.autoPopulate?.geminiResponseFields || [];
  const autoPopulateDescriptions = autoPopulateFields
    .map((f) => `"${f.key}": ${f.shape} — omit or leave an empty array if none apply`)
    .join('\n');

  const cleanedBrief = cleanBrief(body.brief);
  const briefLine = cleanedBrief && Object.keys(cleanedBrief).length ? `Ad brief context: ${JSON.stringify(cleanedBrief)}.` : '';
  // Hidden underscore-prefixed bookkeeping keys (_stale, _ai_snapshot) are the
  // frontend's own state, not creative content — Gemini never needs them.
  // Also drop any key that isn't actually in this item's fieldsSchema — an
  // auto-populated item (e.g. a Background created from Story's autoPopulate)
  // is seeded with a generic `description` field that doesn't match its real
  // schema (location/lighting/style); left in, it sat alongside genuinely new
  // field values and Gemini would favor the older, fuller stale text over a
  // freshly-typed field, silently ignoring what the designer just entered.
  const schemaKeys = new Set(schema.map((f) => f.key));
  const currentFieldsClean: Record<string, unknown> = {};
  for (const k of Object.keys(body.currentFields || {})) {
    if (!k.startsWith('_') && schemaKeys.has(k)) currentFieldsClean[k] = body.currentFields![k];
  }
  const currentLine = Object.keys(currentFieldsClean).length
    ? `Current values, edit/improve rather than ignore them: ${JSON.stringify(currentFieldsClean)}.`
    : '';
  const guidance = itemConfig.content.geminiInstruction || '';
  const language = typeof cleanedBrief?.language === 'string' ? cleanedBrief.language : '';
  const languageLine = language
    ? `Write any dialogue, captions, or spoken lines in ${language}, using ${language}'s own native script — do not translate them to English, and if the brief's own script wrote it phonetically in Latin letters (e.g. "vaangitu vaa"), convert it to proper ${language} script rather than keeping the Latin transliteration.`
    : '';
  const attachedFiles = (body.attachedFileNames || []).filter(Boolean);
  const attachLine = attachedFiles.length
    ? `These real files will be attached alongside this prompt in Google Flow: ${attachedFiles.join(', ')}. Reference them by their exact file name in the "prompt" field (e.g. "using the attached ${attachedFiles[0]}...") so Flow knows which attachment applies to what.`
    : '';
  // Textual backup for whatever the attached reference images show visually —
  // an image alone can be ambiguous (a subtle color, a detail the model
  // doesn't pick up on), so repeating each featured item's actual approved
  // details as text too gives Flow two independent signals instead of one.
  const featuredItems = (body.featuredItems || []).filter((f) => f.name);
  const featuredLine = featuredItems.length
    ? `Featured in this scene (already approved and locked — replicate their appearance exactly as described below, do not redesign or reinterpret them): ${featuredItems.map((f) => `${f.name} (${f.summary || ''})`).join('; ')}.`
    : '';
  const itemLabel = itemConfig.label || itemKey;

  const prompt = `You are helping a UGC video ad designer fill in the "${itemLabel}" part of a Google-Flow video generation pipeline.
${briefLine}
${currentLine}
${guidance}
${languageLine}
${attachLine}
${featuredLine}

Return a JSON object with exactly these fields:
${fieldDescriptions}
${autoPopulateDescriptions}

Also include a "prompt" field: one natural-language paragraph combining the above, ready to paste directly into Google Flow as an image/video generation prompt. Be concrete and specific — never use placeholder text.

Respond with ONLY the JSON object. No markdown, no code fences, no explanation. The response must be strictly valid JSON: escape every double-quote (\\"), backslash (\\\\), and line break (\\n) that appears inside a string value, never use an invalid escape like \\', and never leave a trailing comma before a closing } or ]. Avoid using double quotes (") inside any field's text at all — if you need to quote a name, phrase, or brand, use single quotes (') instead, since a stray unescaped double quote breaks the JSON.`;

  // Every call is timestamped and echoed back to the caller (below) so the
  // frontend debug console can show exactly what was sent/received per click —
  // this is the only record of it; nothing is persisted server-side.
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
  // Cut off mid-JSON by hitting the output cap — tell the caller exactly
  // that, instead of letting it fall through to a confusing "invalid JSON".
  if (finishReason === 'MAX_TOKENS') {
    return c.json(
      {
        error: 'gemini_truncated',
        message: 'The AI response was cut off before it finished (too long for the current limit) — try again, or ask for fewer/shorter panels.',
        debug: { ...debugBase, rawResponse: text, finishReason },
      },
      502
    );
  }
  // A content-safety trigger can also cut a response short mid-generation —
  // a totally different cause than hitting the length cap, and one no
  // amount of JSON repair can fix. Surfacing it distinctly instead of
  // letting it fall through to the generic invalid-JSON message.
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
        // Last resort: force-close whatever string/braces are still open at
        // the end of the text. This can turn a genuinely truncated response
        // into something usable — but the caller MUST be told this
        // happened (truncatedRepair below), since the last field's value
        // may end mid-sentence, and this content will later be treated as
        // "approved, locked, replicate exactly" by Scene/Movie generation —
        // silently succeeding here would be worse than failing outright.
        try {
          const closed = forceCloseJson(repairJsonText(text));
          if (!closed) throw e3;
          parsed = JSON.parse(closed);
          truncatedRepair = true;
        } catch {
          // The exact parse error (e.g. "Unexpected token ',' at position 412")
          // is what actually tells us what went wrong — surfacing it instead of
          // just the opaque error code is the whole point of asking for this.
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
  // Unreachable in practice (every failure path above returns early) — just
  // satisfies the type checker that `parsed` is definitely set below.
  if (!parsed) return c.json({ error: 'gemini_invalid_json', message: 'Unexpected empty parse result.', debug: { ...debugBase, rawResponse: text, finishReason } }, 502);

  // Sanitize: only known keys survive, and pill/tile values must be one of
  // the real option list — a hallucinated option can't leak into the UI.
  const fields: Record<string, unknown> = {};
  for (const def of schema) {
    if (!(def.key in parsed)) continue;
    const val = parsed[def.key];
    if (def.options) {
      fields[def.key] = def.options.includes(val as string) ? val : def.options[0];
    } else {
      fields[def.key] = val;
    }
  }
  const promptText = typeof parsed.prompt === 'string' ? parsed.prompt : '';

  let autoPopulate: Record<string, Record<string, string>[]> | undefined;
  if (autoPopulateFields.length) {
    autoPopulate = {};
    for (const f of autoPopulateFields) {
      autoPopulate[f.key] = sanitizeAutoPopulateEntries(parsed[f.key], extractSecondaryKeys(f.shape));
    }
  }

  return c.json({
    fields,
    prompt: promptText,
    autoPopulate,
    warning: truncatedRepair ? 'Gemini\'s response was cut off and auto-repaired — the last field may end mid-sentence. Review carefully before trusting it.' : undefined,
    debug: { ...debugBase, rawResponse: text, finishReason },
  });
});

// Decoupled from /suggest on purpose: auto-populate used to only ever fire
// as a side-effect of a fresh Story generation, so a designer who hand-edits
// the Story prompt after customer feedback (instead of regenerating via AI)
// had no way to re-sync Stage 3's Characters/Properties/Backgrounds/Sounds —
// they'd silently drift out of date. This takes whatever text is currently
// in the prompt — AI-written or hand-edited, doesn't matter — and asks
// Gemini specifically to extract the auto-populate arrays from it, callable
// any time, not tied to a generation.
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

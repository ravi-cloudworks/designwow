import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';
import { buildZip, type ZipEntry } from '../lib/zip';

const pay = new Hono<{ Bindings: Bindings }>();

async function projectBelongsToUser(db: D1Database, projectId: string, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT user_id FROM projects WHERE id = ?').bind(projectId).first<{ user_id: string }>();
  return !!row && row.user_id === userId;
}

// Same guard rail as item creation (see items.ts) — a designer can't set an
// amount for a stage until the stage before it is locked (paid and approved
// by the customer, even at ₹0).
async function previousStageLocked(db: D1Database, projectId: string, stage: number): Promise<boolean> {
  if (stage <= 2) {
    const brief = await db.prepare('SELECT locked FROM stage1_brief WHERE project_id = ?').bind(projectId).first<{ locked: number }>();
    return !!brief?.locked;
  }
  const lock = await db.prepare('SELECT locked FROM stage_locks WHERE project_id = ? AND stage = ?').bind(projectId, stage - 1).first<{ locked: number }>();
  return !!lock?.locked;
}

// Records a payment permanently in earnings_log, separate from
// payment_link_stages (which resets whenever an earlier stage is unlocked).
// Only ever called right after an UPDATE that's guarded with "AND paid = 0",
// so this only fires on a genuine unpaid->paid transition — never double-
// logs the same payment if confirm-paid/mark-paid gets called again on an
// already-paid stage.
async function logEarning(db: D1Database, token: string, stage: number): Promise<void> {
  const row = await db.prepare(
    `SELECT pl.project_id, pls.amount_paise, pls.paid_at FROM payment_link_stages pls
     JOIN payment_links pl ON pl.token = pls.token
     WHERE pls.token = ? AND pls.stage = ?`
  )
    .bind(token, stage)
    .first<{ project_id: string; amount_paise: number; paid_at: string }>();
  if (!row) return;
  await db
    .prepare('INSERT INTO earnings_log (id, project_id, stage, amount_paise, paid_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), row.project_id, stage, row.amount_paise, row.paid_at)
    .run();
}

async function stageLaneTitle(db: D1Database, stage: number): Promise<string> {
  const row = await db.prepare('SELECT config FROM stage_prompts WHERE stage = ?').bind(stage).first<{ config: string }>();
  if (!row) return `Stage ${stage}`;
  const config = JSON.parse(row.config) as { laneTitle?: string };
  return config.laneTitle || `Stage ${stage}`;
}

// Every project gets a link row at creation time (see projects.ts) — this is
// a defensive fallback only, for any project that predates that or slipped
// through some other way, so the feature never hard-fails on a missing row.
async function getOrCreateLink(db: D1Database, projectId: string): Promise<string> {
  const existing = await db.prepare('SELECT token FROM payment_links WHERE project_id = ?').bind(projectId).first<{ token: string }>();
  if (existing) return existing.token;
  const token = crypto.randomUUID();
  await db.prepare('INSERT INTO payment_links (token, project_id) VALUES (?, ?)').bind(token, projectId).run();
  return token;
}

// ---------- Designer-facing, authenticated ----------
// The one link for this project, plus every stage that currently has an
// amount set — covers both "show me the link to share" and "show me earned
// so far per stage" in a single call.
pay.get('/projects/:id/payment-link', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const projectId = c.req.param('id');
  if (!(await projectBelongsToUser(c.env.DB, projectId, userId))) return c.json({ error: 'forbidden' }, 403);

  const token = await getOrCreateLink(c.env.DB, projectId);
  const { results } = await c.env.DB.prepare('SELECT stage, amount_paise, paid, paid_at FROM payment_link_stages WHERE token = ? ORDER BY stage')
    .bind(token)
    .all<{ stage: number; amount_paise: number; paid: number; paid_at: string | null }>();

  // From earnings_log, not payment_link_stages — this total must survive an
  // earlier stage being unlocked and everything after it reset, since money
  // already collected for completed work doesn't stop being earned.
  const totalRow = await c.env.DB.prepare('SELECT COALESCE(SUM(amount_paise), 0) as total FROM earnings_log WHERE project_id = ?')
    .bind(projectId)
    .first<{ total: number }>();

  // Same fix as the public /pay/:token page: payment_link_stages is a
  // single overwritten row per stage, so a repriced-and-repaid stage
  // otherwise only shows its latest round, silently dropping earlier
  // payments for that same stage from what the swimlane pill displays.
  const { results: history } = await c.env.DB.prepare(
    'SELECT stage, amount_paise, paid_at FROM earnings_log WHERE project_id = ? ORDER BY paid_at ASC'
  )
    .bind(projectId)
    .all<{ stage: number; amount_paise: number; paid_at: string }>();

  return c.json({
    token,
    url: `${c.env.FRONTEND_ORIGIN}/pay/${token}`,
    stages: results.map((r) => {
      const payments = history.filter((h) => h.stage === r.stage);
      return {
        stage: r.stage,
        amountPaise: r.amount_paise,
        paid: !!r.paid,
        paidAt: r.paid_at,
        totalPaidPaise: payments.reduce((sum, h) => sum + h.amount_paise, 0),
        payments: payments.map((h) => ({ amountPaise: h.amount_paise, paidAt: h.paid_at })),
      };
    }),
    totalEarnedPaise: totalRow?.total ?? 0,
  });
});

// Set/update the amount for one stage. No "create" concept here — the link
// itself already exists; this only ever touches that stage's row under it.
pay.put('/projects/:id/payment-link/:stage', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const projectId = c.req.param('id');
  if (!(await projectBelongsToUser(c.env.DB, projectId, userId))) return c.json({ error: 'forbidden' }, 403);
  const stage = Number(c.req.param('stage'));
  if (!(await previousStageLocked(c.env.DB, projectId, stage))) {
    return c.json(
      { error: 'previous_stage_not_locked', message: `Lock Stage ${stage - 1} first — paid and approved by the customer — before setting an amount for Stage ${stage}.` },
      400
    );
  }

  const body = await c.req.json<{ amountPaise?: number }>().catch(() => ({}) as { amountPaise?: number });
  if (!body.amountPaise || body.amountPaise <= 0) return c.json({ error: 'amount_required' }, 400);

  const token = await getOrCreateLink(c.env.DB, projectId);
  const existing = await c.env.DB.prepare('SELECT amount_paise FROM payment_link_stages WHERE token = ? AND stage = ?')
    .bind(token, stage)
    .first<{ amount_paise: number }>();

  if (existing) {
    // Changing the amount invalidates any earlier "paid" confirmation — that
    // was a self-attested click against the OLD amount, not this one. Editing
    // this stage's actual content (a new upload, a regenerated prompt) never
    // touches this table at all, so it never resets payment — only a real
    // price change does.
    const amountChanged = existing.amount_paise !== body.amountPaise;
    const resetClause = amountChanged ? ', paid = 0, paid_at = NULL' : '';
    await c.env.DB.prepare(`UPDATE payment_link_stages SET amount_paise = ?, updated_at = datetime('now')${resetClause} WHERE token = ? AND stage = ?`)
      .bind(body.amountPaise, token, stage)
      .run();
  } else {
    await c.env.DB.prepare('INSERT INTO payment_link_stages (token, stage, amount_paise) VALUES (?, ?, ?)')
      .bind(token, stage, body.amountPaise)
      .run();
  }

  const saved = await c.env.DB.prepare('SELECT paid, paid_at FROM payment_link_stages WHERE token = ? AND stage = ?')
    .bind(token, stage)
    .first<{ paid: number; paid_at: string | null }>();

  return c.json({
    token,
    url: `${c.env.FRONTEND_ORIGIN}/pay/${token}`,
    stage,
    amountPaise: body.amountPaise,
    paid: !!saved?.paid,
    paidAt: saved?.paid_at ?? null,
  });
});

// Designer-side "I've received this payment" — covers the real gap where a
// customer pays via UPI directly but never bothers clicking the public
// page's own confirm button. Either side confirming marks it paid.
pay.post('/projects/:id/payment-link/:stage/confirm-paid', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const projectId = c.req.param('id');
  if (!(await projectBelongsToUser(c.env.DB, projectId, userId))) return c.json({ error: 'forbidden' }, 403);
  const stage = Number(c.req.param('stage'));

  const token = await getOrCreateLink(c.env.DB, projectId);
  const result = await c.env.DB.prepare("UPDATE payment_link_stages SET paid = 1, paid_at = datetime('now') WHERE token = ? AND stage = ? AND paid = 0")
    .bind(token, stage)
    .run();
  if (result.meta.changes) await logEarning(c.env.DB, token, stage);
  const saved = await c.env.DB.prepare('SELECT paid_at FROM payment_link_stages WHERE token = ? AND stage = ?')
    .bind(token, stage)
    .first<{ paid_at: string | null }>();
  if (!saved) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, paidAt: saved.paid_at ?? null });
});

// ---------- Public, no-login: what the customer sees ----------
type Stage1BriefRow = {
  product: string; product_description: string; audience: string; goal: string; video_style: string; tone: string;
  platform: string; duration: number; language: string; hook: string; storyboard: string; cta: string;
  brand_color_primary: string | null; brand_color_secondary: string | null;
  logo_media: string; product_photos: string;
};

async function loadPublicLink(db: D1Database, token: string) {
  const link = await db.prepare('SELECT project_id FROM payment_links WHERE token = ?').bind(token).first<{ project_id: string }>();
  if (!link) return null;

  const project = await db.prepare('SELECT name, user_id FROM projects WHERE id = ?').bind(link.project_id).first<{ name: string; user_id: string }>();
  if (!project) return null;
  const designer = await db.prepare('SELECT name, upi_id FROM users WHERE id = ?').bind(project.user_id).first<{ name: string; upi_id: string }>();
  const brief = await db.prepare('SELECT * FROM stage1_brief WHERE project_id = ?').bind(link.project_id).first<Stage1BriefRow>();

  return { projectId: link.project_id, project, designer, brief };
}

pay.get('/pay/:token', async (c) => {
  const token = c.req.param('token');
  const loaded = await loadPublicLink(c.env.DB, token);
  if (!loaded) return c.json({ error: 'not_found' }, 404);
  const { projectId, project, designer, brief } = loaded;

  const { results } = await c.env.DB.prepare('SELECT stage, amount_paise, paid, paid_at FROM payment_link_stages WHERE token = ? ORDER BY stage')
    .bind(token)
    .all<{ stage: number; amount_paise: number; paid: number; paid_at: string | null }>();

  // Setting a new amount for an already-paid stage (more work, renegotiated
  // price) overwrites this stage's one payment_link_stages row in place —
  // otherwise the customer's page would show the new amount with no trace
  // they'd already paid for this stage before, which reads as if their
  // earlier payment just vanished. earnings_log still has it (append-only),
  // so surface anything there that ISN'T the current row's own payment.
  const { results: history } = await c.env.DB.prepare(
    'SELECT stage, amount_paise, paid_at FROM earnings_log WHERE project_id = ? ORDER BY paid_at ASC'
  )
    .bind(projectId)
    .all<{ stage: number; amount_paise: number; paid_at: string }>();

  const stages = await Promise.all(
    results.map(async (r) => ({
      stage: r.stage,
      stageLabel: await stageLaneTitle(c.env.DB, r.stage),
      amountPaise: r.amount_paise,
      paid: !!r.paid,
      paidAt: r.paid_at,
      priorPayments: history
        .filter((h) => h.stage === r.stage && h.paid_at !== r.paid_at)
        .map((h) => ({ amountPaise: h.amount_paise, paidAt: h.paid_at })),
    }))
  );

  return c.json({
    projectName: project.name,
    designerName: designer?.name || '',
    upiId: designer?.upi_id || '',
    product: brief?.product || '',
    productDescription: brief?.product_description || '',
    stages,
  });
});

pay.post('/pay/:token/mark-paid/:stage', async (c) => {
  const token = c.req.param('token');
  const stage = Number(c.req.param('stage'));
  const result = await c.env.DB.prepare("UPDATE payment_link_stages SET paid = 1, paid_at = datetime('now') WHERE token = ? AND stage = ? AND paid = 0")
    .bind(token, stage)
    .run();
  if (result.meta.changes) await logEarning(c.env.DB, token, stage);
  const exists = await c.env.DB.prepare('SELECT 1 FROM payment_link_stages WHERE token = ? AND stage = ?').bind(token, stage).first();
  if (!exists) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

// Lets the customer verify/download exactly what they gave us — Stage 1 has
// no amount/paid concept (it's their own free-form input, not a delivered
// asset), so it doesn't fit the per-stage accordion rows below; this is a
// standalone route the public page always offers regardless of payment state.
pay.get('/pay/:token/download/brief', async (c) => {
  const token = c.req.param('token');
  const loaded = await loadPublicLink(c.env.DB, token);
  if (!loaded) return c.json({ error: 'not_found' }, 404);
  const { project, brief } = loaded;
  const b = brief;

  const logoMedia = b?.logo_media ? (JSON.parse(b.logo_media) as { key?: string; fileName?: string }) : null;
  const productPhotos = b?.product_photos ? (JSON.parse(b.product_photos) as { key: string; fileName: string }[]) : [];
  const colorLines = [
    b?.brand_color_primary ? `- Primary: ${b.brand_color_primary}` : '',
    b?.brand_color_secondary ? `- Secondary: ${b.brand_color_secondary}` : '',
  ].filter(Boolean);

  const markdown = `# Client Brief — ${b?.product || '(product)'}

**Goal:** ${b?.goal || '—'}
**Video Style:** ${b?.video_style || '—'}
**Tone:** ${b?.tone || '—'}
**Target Audience:** ${b?.audience || '—'}
**Platform:** ${b?.platform || '—'}
**Duration:** ${b?.duration || '—'} seconds
**Language:** ${b?.language || '—'}

## Product Description
${b?.product_description || '—'}

## Hook
${b?.hook || '—'}

## Storyboard / Dialogue
${b?.storyboard || '—'}

## Call to Action
${b?.cta || '—'}

## Brand Colors
${colorLines.length ? colorLines.join('\n') : '- —'}

## Assets
- Logo: ${logoMedia?.fileName || 'not uploaded yet'}
- Product photos: ${productPhotos.length ? productPhotos.map((p) => p.fileName).join(', ') : 'none uploaded yet'}
`;

  const entries: ZipEntry[] = [{ name: 'brief.md', data: new TextEncoder().encode(markdown) }];
  const usedNames = new Set(['brief.md']);
  const addFile = async (key: string, fileName: string) => {
    const obj = await c.env.MEDIA.get(key);
    if (!obj) return;
    let name = fileName;
    let n = 2;
    while (usedNames.has(name)) { name = `${n}-${fileName}`; n++; }
    usedNames.add(name);
    entries.push({ name, data: new Uint8Array(await obj.arrayBuffer()) });
  };
  if (logoMedia?.key) await addFile(logoMedia.key, logoMedia.fileName || 'logo');
  for (const p of productPhotos) await addFile(p.key, p.fileName);

  const zipBytes = buildZip(entries);
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'project';
  return new Response(zipBytes, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="brief-${slug}.zip"`,
    },
  });
});

// Builds the same "stage package" zip the designer's own Download button
// makes, from server-side data only (saved prompt text + attached output
// files) — no live recompilation of Setup fields, since the public page has
// no authenticated frontend state to compile from. Customer-facing package:
// only the actual uploaded deliverable files (the images/videos generated in
// Flow and attached back) — no prompt text. The designer's own internal
// "Download" button (client-side, authenticated) still includes prompt.txt
// for their own reference; this public route is what the paying customer receives.
pay.get('/pay/:token/download/:stage', async (c) => {
  const token = c.req.param('token');
  const stage = Number(c.req.param('stage'));
  const loaded = await loadPublicLink(c.env.DB, token);
  if (!loaded) return c.json({ error: 'not_found' }, 404);
  const { projectId, project } = loaded;
  const db = c.env.DB;

  const entries: ZipEntry[] = [];
  const usedNames = new Set<string>();
  const addFile = async (key: string, fileName: string) => {
    const obj = await c.env.MEDIA.get(key);
    if (!obj) return;
    let name = fileName;
    let n = 2;
    while (usedNames.has(name)) { name = `${n}-${fileName}`; n++; }
    usedNames.add(name);
    entries.push({ name, data: new Uint8Array(await obj.arrayBuffer()) });
  };

  const { results: versions } = await db.prepare(
    `SELECT iv.* FROM item_versions iv JOIN items i ON i.id = iv.item_id WHERE i.project_id = ? AND i.stage = ?`
  )
    .bind(projectId, stage)
    .all<Record<string, unknown>>();
  for (const v of versions) {
    const mediaFiles = JSON.parse((v.media_files as string) || '[]') as { key: string; fileName: string }[];
    for (const f of mediaFiles) await addFile(f.key, f.fileName);
  }

  const zipBytes = buildZip(entries);
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'project';
  return new Response(zipBytes, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="stage${stage}-${slug}.zip"`,
    },
  });
});

export default pay;

import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';

const projects = new Hono<{ Bindings: Bindings }>();

const BRIEF_FIELDS = [
  'product',
  'product_description',
  'audience',
  'goal',
  'video_style',
  'tone',
  'platform',
  'duration',
  'language',
  'hook',
  'storyboard',
  'cta',
  'brand_color_primary',
  'brand_color_secondary',
  'brand_color_accent',
] as const;

// Everything a designer must have filled in before locking the brief —
// accent color is deliberately excluded (nice-to-have, not essential).
const REQUIRED_BRIEF_FIELDS = [
  ['product', 'Product / brand'],
  ['product_description', 'Product description'],
  ['goal', 'Goal'],
  ['video_style', 'Video Style'],
  ['tone', 'Tone'],
  ['audience', 'Target Audience'],
  ['platform', 'Platform'],
  ['language', 'Language'],
  ['hook', 'Hook'],
  ['storyboard', 'Storyboard / dialogue'],
  ['cta', 'Call to action'],
  ['brand_color_primary', 'Primary color'],
  ['brand_color_secondary', 'Secondary color'],
] as const;

projects.post('/', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const id = crypto.randomUUID();
  const name = body.name?.trim() || 'Untitled project';
  await c.env.DB.prepare('INSERT INTO projects (id, user_id, name) VALUES (?, ?, ?)').bind(id, userId, name).run();
  await c.env.DB.prepare('INSERT INTO stage1_brief (project_id) VALUES (?)').bind(id).run();
  // One payment link per project, ready from the moment it exists — nothing
  // to "create" later, the designer only ever sets/updates per-stage amounts.
  await c.env.DB.prepare('INSERT INTO payment_links (token, project_id) VALUES (?, ?)').bind(crypto.randomUUID(), id).run();
  return c.json({ id, name }, 201);
});

projects.get('/', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  // Correlated subquery so the list page can show "how much have I actually
  // been paid on this project" without a separate round trip per project.
  // Sourced from earnings_log (not payment_link_stages), so this total
  // survives an earlier stage being unlocked and reset — money already
  // collected for completed work doesn't stop counting just because of a
  // later revision.
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.mode, p.created_at, p.updated_at,
       COALESCE((SELECT SUM(amount_paise) FROM earnings_log WHERE project_id = p.id), 0) AS earned_paise
     FROM projects p WHERE p.user_id = ? ORDER BY p.updated_at DESC`
  )
    .bind(userId)
    .all();
  return c.json({ projects: results });
});

projects.get('/:id', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const id = c.req.param('id');
  const project = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<{ user_id: string }>();
  if (!project) return c.json({ error: 'not_found' }, 404);
  if (project.user_id !== userId) return c.json({ error: 'forbidden' }, 403);

  const brief = await c.env.DB.prepare('SELECT * FROM stage1_brief WHERE project_id = ?').bind(id).first();

  const { results: items } = await c.env.DB.prepare(
    'SELECT * FROM items WHERE project_id = ? ORDER BY stage, order_index'
  )
    .bind(id)
    .all();

  const { results: versions } = await c.env.DB.prepare(
    `SELECT iv.* FROM item_versions iv JOIN items i ON i.id = iv.item_id WHERE i.project_id = ? ORDER BY iv.version_number`
  )
    .bind(id)
    .all();

  const versionsByItem = new Map<string, unknown[]>();
  for (const v of versions as Record<string, unknown>[]) {
    const itemId = v.item_id as string;
    const parsed = {
      ...v,
      fields: JSON.parse((v.fields as string) || '{}'),
      media_files: JSON.parse((v.media_files as string) || '[]'),
    };
    const list = versionsByItem.get(itemId) ?? [];
    list.push(parsed);
    versionsByItem.set(itemId, list);
  }

  const itemsWithVersions = (items as Record<string, unknown>[]).map((item) => ({
    ...item,
    versions: versionsByItem.get(item.id as string) ?? [],
  }));

  const briefParsed = brief
    ? {
        ...brief,
        logo_media: JSON.parse((brief.logo_media as string) || '{}'),
        product_photos: JSON.parse((brief.product_photos as string) || '[]'),
        locked: !!brief.locked,
      }
    : null;

  return c.json({ project, brief: briefParsed, items: itemsWithVersions });
});

projects.patch('/:id', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const id = c.req.param('id');
  type UpdateProjectBody = { name?: string; mode?: 'manual' | 'agent' };
  const body = await c.req.json<UpdateProjectBody>().catch(() => ({}) as UpdateProjectBody);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.name !== undefined) {
    sets.push('name = ?');
    binds.push(body.name);
  }
  if (body.mode !== undefined) {
    sets.push('mode = ?');
    binds.push(body.mode);
  }
  if (!sets.length) return c.json({ error: 'nothing_to_update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(id, userId);
  const result = await c.env.DB.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...binds)
    .run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

projects.delete('/:id', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const id = c.req.param('id');
  const result = await c.env.DB.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').bind(id, userId).run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

projects.patch('/:id/brief', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const id = c.req.param('id');
  const owner = await c.env.DB.prepare('SELECT user_id FROM projects WHERE id = ?').bind(id).first<{ user_id: string }>();
  if (!owner) return c.json({ error: 'not_found' }, 404);
  if (owner.user_id !== userId) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const isLockAction = body.lock === true;

  // Once validated with the customer, the brief is read-only — the only way
  // past this is the dedicated unlock route, which is destructive on purpose
  // (wipes stages 2-5) rather than silently letting an edit slip through.
  if (!isLockAction) {
    const current = await c.env.DB.prepare('SELECT locked FROM stage1_brief WHERE project_id = ?').bind(id).first<{ locked: number }>();
    if (current && current.locked) {
      return c.json({ error: 'brief_locked', message: 'Brief is locked — unlock it first to make changes.' }, 400);
    }
  } else {
    // Backend safety net — the frontend already checks this before offering
    // the lock button, but re-checking here means the gate can't be bypassed
    // by calling the API directly.
    const row = await c.env.DB.prepare('SELECT * FROM stage1_brief WHERE project_id = ?').bind(id).first<Record<string, unknown>>();
    if (!row) return c.json({ error: 'not_found' }, 404);
    const missing: string[] = [];
    for (const [field, label] of REQUIRED_BRIEF_FIELDS) {
      if (!row[field]) missing.push(label);
    }
    const logoMedia = JSON.parse((row.logo_media as string) || '{}');
    if (!logoMedia.key) missing.push('Logo');
    const productPhotos = JSON.parse((row.product_photos as string) || '[]');
    if (!productPhotos.length) missing.push('Product photos');
    if (missing.length) {
      return c.json({ error: 'brief_incomplete', message: `Fill in before locking: ${missing.join(', ')}`, missing }, 400);
    }
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const field of BRIEF_FIELDS) {
    const camel = field.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
    if (body[camel] !== undefined) {
      sets.push(`${field} = ?`);
      binds.push(body[camel]);
    }
  }
  if (body.logoMedia !== undefined) {
    sets.push('logo_media = ?');
    binds.push(JSON.stringify(body.logoMedia));
  }
  if (body.productPhotos !== undefined) {
    sets.push('product_photos = ?');
    binds.push(JSON.stringify(body.productPhotos));
  }
  if (isLockAction) {
    sets.push('locked = 1');
  }
  if (!sets.length) return c.json({ error: 'nothing_to_update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  const result = await c.env.DB.prepare(`UPDATE stage1_brief SET ${sets.join(', ')} WHERE project_id = ?`)
    .bind(...binds)
    .run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

// Deliberately destructive: unlocking after production has started on later
// stages means those stages were built from a brief that's about to change,
// so they're wiped rather than left silently inconsistent (see the "no
// partial staleness tracking" call from earlier in this session).
projects.post('/:id/unlock-brief', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const id = c.req.param('id');
  const owner = await c.env.DB.prepare('SELECT user_id FROM projects WHERE id = ?').bind(id).first<{ user_id: string }>();
  if (!owner) return c.json({ error: 'not_found' }, 404);
  if (owner.user_id !== userId) return c.json({ error: 'forbidden' }, 403);

  await c.env.DB.prepare('UPDATE stage1_brief SET locked = 0 WHERE project_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM items WHERE project_id = ? AND stage >= 2').bind(id).run();
  await c.env.DB.prepare('DELETE FROM stage_locks WHERE project_id = ? AND stage >= 2').bind(id).run();
  const briefUnlockLink = await c.env.DB.prepare('SELECT token FROM payment_links WHERE project_id = ?').bind(id).first<{ token: string }>();
  if (briefUnlockLink) {
    await c.env.DB.prepare('DELETE FROM payment_link_stages WHERE token = ? AND stage >= 2').bind(briefUnlockLink.token).run();
  }
  return c.json({ ok: true });
});

// Every stage's lock status at once — used to show "🔒 Validated" vs the
// lock button per stage without one request per stage.
projects.get('/:id/stage-locks', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const id = c.req.param('id');
  const owner = await c.env.DB.prepare('SELECT user_id FROM projects WHERE id = ?').bind(id).first<{ user_id: string }>();
  if (!owner) return c.json({ error: 'not_found' }, 404);
  if (owner.user_id !== userId) return c.json({ error: 'forbidden' }, 403);

  const { results } = await c.env.DB.prepare('SELECT stage, locked, locked_at FROM stage_locks WHERE project_id = ?')
    .bind(id)
    .all<{ stage: number; locked: number; locked_at: string | null }>();
  return c.json({ locks: results.map((r) => ({ stage: r.stage, locked: !!r.locked, lockedAt: r.locked_at })) });
});

projects.post('/:id/stages/:stage/lock', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const id = c.req.param('id');
  const stage = Number(c.req.param('stage'));
  const owner = await c.env.DB.prepare('SELECT user_id FROM projects WHERE id = ?').bind(id).first<{ user_id: string }>();
  if (!owner) return c.json({ error: 'not_found' }, 404);
  if (owner.user_id !== userId) return c.json({ error: 'forbidden' }, 403);

  // Backend safety net — the frontend already checks this before offering the
  // lock button, but re-checking here means it can't be bypassed by calling
  // the API directly: a stage can't be locked without an uploaded deliverable
  // and a paid invoice.
  const missing: string[] = [];
  const { results: versions } = await c.env.DB.prepare(
    `SELECT iv.media_files FROM item_versions iv JOIN items i ON i.id = iv.item_id WHERE i.project_id = ? AND i.stage = ?`
  )
    .bind(id, stage)
    .all<{ media_files: string }>();
  const hasUpload = versions.some((v) => {
    try { return JSON.parse(v.media_files || '[]').length > 0; } catch { return false; }
  });
  if (!hasUpload) missing.push('upload a file');

  const link = await c.env.DB.prepare('SELECT token FROM payment_links WHERE project_id = ?').bind(id).first<{ token: string }>();
  const stageRow = link
    ? await c.env.DB.prepare('SELECT paid FROM payment_link_stages WHERE token = ? AND stage = ?').bind(link.token, stage).first<{ paid: number }>()
    : null;
  if (!stageRow) missing.push('set an amount');
  else if (!stageRow.paid) missing.push('confirm payment received');

  if (missing.length) {
    return c.json({ error: 'stage_incomplete', message: `Before locking: ${missing.join(', ')}`, missing }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT 1 FROM stage_locks WHERE project_id = ? AND stage = ?').bind(id, stage).first();
  if (existing) {
    await c.env.DB.prepare("UPDATE stage_locks SET locked = 1, locked_at = datetime('now') WHERE project_id = ? AND stage = ?").bind(id, stage).run();
  } else {
    await c.env.DB.prepare("INSERT INTO stage_locks (project_id, stage, locked, locked_at) VALUES (?, ?, 1, datetime('now'))").bind(id, stage).run();
  }
  return c.json({ ok: true });
});

// Deliberately destructive, same as unlock-brief: this stage's content is
// about to change, so everything built AFTER it (which assumed this stage
// was final) is wiped — items and their payment records both — rather than
// left silently stale. Stages before this one are untouched; they don't
// depend on it.
projects.post('/:id/stages/:stage/unlock', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const id = c.req.param('id');
  const stage = Number(c.req.param('stage'));
  const owner = await c.env.DB.prepare('SELECT user_id FROM projects WHERE id = ?').bind(id).first<{ user_id: string }>();
  if (!owner) return c.json({ error: 'not_found' }, 404);
  if (owner.user_id !== userId) return c.json({ error: 'forbidden' }, 403);

  await c.env.DB.prepare('UPDATE stage_locks SET locked = 0 WHERE project_id = ? AND stage = ?').bind(id, stage).run();
  await c.env.DB.prepare('DELETE FROM stage_locks WHERE project_id = ? AND stage > ?').bind(id, stage).run();
  await c.env.DB.prepare('DELETE FROM items WHERE project_id = ? AND stage > ?').bind(id, stage).run();
  const link = await c.env.DB.prepare('SELECT token FROM payment_links WHERE project_id = ?').bind(id).first<{ token: string }>();
  if (link) {
    await c.env.DB.prepare('DELETE FROM payment_link_stages WHERE token = ? AND stage > ?').bind(link.token, stage).run();
  }
  return c.json({ ok: true });
});

export default projects;

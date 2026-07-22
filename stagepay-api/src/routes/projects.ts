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

// No plan/subscription tiers exist to gate this by yet — a single fixed
// cap for now (same pattern as SHOWCASE_MAX_ITEMS). Deleting a project frees
// up the slot — see the DELETE route below, which now actually cleans up
// everything a deleted project owned rather than just its DB rows.
const MAX_PROJECTS = 50;

projects.post('/', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const countRow = await c.env.DB.prepare('SELECT COUNT(*) as count FROM projects WHERE user_id = ?').bind(userId).first<{ count: number }>();
  if ((countRow?.count ?? 0) >= MAX_PROJECTS) {
    return c.json({ error: 'project_limit_reached', max: MAX_PROJECTS, message: `You've reached the ${MAX_PROJECTS}-project limit — delete an old one to make room for a new one.` }, 400);
  }
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
  //
  // top_stage/top_stage_locked: stage_locks only ever gets a row once a
  // stage has been locked at least once (see PUT /:id/lock below) — a
  // project still on Stage 1 has zero rows. The highest such row tells you
  // where the project actually is: locked means that stage is done and
  // work has moved on to the next one; unlocked means that's the stage
  // being worked on right now.
  // earned_count/pending_*: same idea as earned_paise — lets the projects
  // list show not just what's been paid, but how many priced-but-unpaid
  // rounds are still sitting open (a lightweight receivables view), without
  // a separate round trip per project. pending_* is sourced from
  // payment_link_stages (via payment_links, its only link to project_id)
  // rather than earnings_log, since an unpaid round has no earnings_log row
  // yet — it only gets one once actually paid.
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.name, p.mode, p.created_at, p.updated_at,
       COALESCE((SELECT SUM(amount_paise) FROM earnings_log WHERE project_id = p.id), 0) AS earned_paise,
       (SELECT COUNT(*) FROM earnings_log WHERE project_id = p.id) AS earned_count,
       COALESCE((SELECT SUM(pls.amount_paise) FROM payment_link_stages pls JOIN payment_links pl ON pl.token = pls.token WHERE pl.project_id = p.id AND pls.paid = 0), 0) AS pending_paise,
       (SELECT COUNT(*) FROM payment_link_stages pls JOIN payment_links pl ON pl.token = pls.token WHERE pl.project_id = p.id AND pls.paid = 0) AS pending_count,
       (SELECT stage FROM stage_locks WHERE project_id = p.id ORDER BY stage DESC LIMIT 1) AS top_stage,
       (SELECT locked FROM stage_locks WHERE project_id = p.id ORDER BY stage DESC LIMIT 1) AS top_stage_locked
     FROM projects p WHERE p.user_id = ? ORDER BY p.updated_at DESC`
  )
    .bind(userId)
    .all<{
      id: string; name: string; mode: string; created_at: string; updated_at: string;
      earned_paise: number; earned_count: number; pending_paise: number; pending_count: number;
      top_stage: number | null; top_stage_locked: number | null;
    }>();

  const projectsWithStage = results.map(({ top_stage, top_stage_locked, ...rest }) => ({
    ...rest,
    // The Math.min clamp below (avoiding a nonexistent "Stage 6" once Stage 5
    // locks) used to conflate two different states into the same value:
    // "Stage 4 done, now on Stage 5" and "Stage 5 done, project complete"
    // both produced current_stage 5. completed distinguishes them so the
    // frontend can show a real "done" state instead of just "Stage 5" forever.
    current_stage: top_stage == null ? 1 : top_stage_locked ? Math.min(top_stage + 1, 5) : top_stage,
    completed: top_stage === 5 && !!top_stage_locked,
  }));
  return c.json({ projects: projectsWithStage, max: MAX_PROJECTS });
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
  type UpdateProjectBody = { name?: string };
  const body = await c.req.json<UpdateProjectBody>().catch(() => ({}) as UpdateProjectBody);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.name !== undefined) {
    sets.push('name = ?');
    binds.push(body.name);
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

// Deleting a project used to only ever run one SQL DELETE and rely on
// foreign-key cascades for everything else — which cleans up every DB row
// (brief, items, item versions, payment links/history, stage locks) but
// misses two things cascades can't reach: the actual R2-stored files
// (uploads never referenced anywhere but by their own key, so nothing
// cascades to them), and showcase_items sourced from this project's items
// (source_item_id carries no foreign key at all, so those would otherwise
// survive as orphaned records pointing at a project that no longer exists).
// Both are cleaned up here, before the cascade deletes the rows this needs
// to look them up by.
projects.delete('/:id', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const id = c.req.param('id');

  const owner = await c.env.DB.prepare('SELECT user_id FROM projects WHERE id = ?').bind(id).first<{ user_id: string }>();
  if (!owner) return c.json({ error: 'not_found' }, 404);
  if (owner.user_id !== userId) return c.json({ error: 'forbidden' }, 403);

  const { results: orphanedShowcase } = await c.env.DB.prepare(
    `SELECT si.id, si.thumbnail_r2_key FROM showcase_items si
     JOIN items i ON i.id = si.source_item_id
     WHERE i.project_id = ?`
  )
    .bind(id)
    .all<{ id: string; thumbnail_r2_key: string | null }>();
  for (const s of orphanedShowcase) {
    if (s.thumbnail_r2_key) await c.env.MEDIA.delete(s.thumbnail_r2_key);
  }
  if (orphanedShowcase.length) {
    await c.env.DB.prepare(`DELETE FROM showcase_items WHERE id IN (${orphanedShowcase.map(() => '?').join(',')})`)
      .bind(...orphanedShowcase.map((s) => s.id))
      .run();
  }

  // Every media file this project ever generated (item uploads, brief
  // logo/product photos) shares the same `${userId}/${projectId}/` key
  // prefix — sweep and delete all of them.
  let cursor: string | undefined;
  do {
    const listed = await c.env.MEDIA.list({ prefix: `${userId}/${id}/`, cursor });
    if (listed.objects.length) {
      await Promise.all(listed.objects.map((o) => c.env.MEDIA.delete(o.key)));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  await c.env.DB.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').bind(id, userId).run();
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

  // Same orphaning risk as project deletion (see the DELETE /:id route's
  // comment) — showcase_items has no foreign key back to its source item,
  // so any item this is about to delete that was also showcased needs its
  // showcase entry cleaned up here too, or it survives pointing at nothing.
  const { results: orphanedShowcase } = await c.env.DB.prepare(
    `SELECT si.id, si.thumbnail_r2_key FROM showcase_items si
     JOIN items i ON i.id = si.source_item_id
     WHERE i.project_id = ? AND i.stage > ?`
  )
    .bind(id, stage)
    .all<{ id: string; thumbnail_r2_key: string | null }>();
  for (const s of orphanedShowcase) {
    if (s.thumbnail_r2_key) await c.env.MEDIA.delete(s.thumbnail_r2_key);
  }
  if (orphanedShowcase.length) {
    await c.env.DB.prepare(`DELETE FROM showcase_items WHERE id IN (${orphanedShowcase.map(() => '?').join(',')})`)
      .bind(...orphanedShowcase.map((s) => s.id))
      .run();
  }

  await c.env.DB.prepare('DELETE FROM items WHERE project_id = ? AND stage > ?').bind(id, stage).run();
  const link = await c.env.DB.prepare('SELECT token FROM payment_links WHERE project_id = ?').bind(id).first<{ token: string }>();
  if (link) {
    await c.env.DB.prepare('DELETE FROM payment_link_stages WHERE token = ? AND stage > ?').bind(link.token, stage).run();
  }
  return c.json({ ok: true });
});

export default projects;

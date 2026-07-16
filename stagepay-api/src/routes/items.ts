import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';

const items = new Hono<{ Bindings: Bindings }>();

async function projectBelongsToUser(db: D1Database, projectId: string, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT user_id FROM projects WHERE id = ?').bind(projectId).first<{ user_id: string }>();
  return !!row && row.user_id === userId;
}

// Items don't carry a user_id themselves — ownership is always resolved
// through the project they belong to, one JOIN, so there's a single source
// of truth for "who owns this" rather than a second copy to keep in sync.
async function itemProjectId(db: D1Database, itemId: string): Promise<string | null> {
  const row = await db.prepare('SELECT project_id FROM items WHERE id = ?').bind(itemId).first<{ project_id: string }>();
  return row?.project_id ?? null;
}

// Guard rail mirrored server-side (the frontend already disables the
// relevant buttons) so a designer can't start real work on a stage —
// creating a Character/Property/Background/Sound/Scene item — until the
// stage before it has been locked (paid and approved by the customer, even
// at ₹0). Stage 2's Story item is the one exception: it's created
// immediately after the Stage 1 brief lock succeeds, in the same flow, so
// by the time that call lands the brief is already locked.
async function previousStageLocked(db: D1Database, projectId: string, stage: number): Promise<boolean> {
  if (stage <= 2) {
    const brief = await db.prepare('SELECT locked FROM stage1_brief WHERE project_id = ?').bind(projectId).first<{ locked: number }>();
    return !!brief?.locked;
  }
  const lock = await db.prepare('SELECT locked FROM stage_locks WHERE project_id = ? AND stage = ?').bind(projectId, stage - 1).first<{ locked: number }>();
  return !!lock?.locked;
}

items.post('/projects/:projectId/items', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const projectId = c.req.param('projectId');
  if (!(await projectBelongsToUser(c.env.DB, projectId, userId))) return c.json({ error: 'forbidden' }, 403);

  type CreateItemBody = {
    stage?: number;
    itemKey?: string;
    parentItemId?: string | null;
    orderIndex?: number;
    name?: string;
  };
  const body = await c.req.json<CreateItemBody>().catch(() => ({}) as CreateItemBody);
  if (!body.stage || !body.itemKey) return c.json({ error: 'stage_and_itemKey_required' }, 400);
  // 'movie' is never independently added by a designer — it's always created
  // as a mechanical pairing right alongside its parent Scene (stage 4, which
  // is itself correctly gated below), before Stage 4 is anywhere near
  // locked. Gating it here too would break scene creation entirely.
  if (body.itemKey !== 'movie' && !(await previousStageLocked(c.env.DB, projectId, body.stage))) {
    return c.json(
      { error: 'previous_stage_not_locked', message: `Lock Stage ${body.stage - 1} first — paid and approved by the customer — before adding items to Stage ${body.stage}.` },
      400
    );
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO items (id, project_id, stage, item_key, parent_item_id, order_index, name)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, projectId, body.stage, body.itemKey, body.parentItemId ?? null, body.orderIndex ?? 0, body.name ?? '')
    .run();

  // Single version row — versioning was dropped as unnecessary complexity.
  await c.env.DB.prepare(
    `INSERT INTO item_versions (id, item_id, version_number, fields, prompt) VALUES (?, ?, 1, '{}', '')`
  )
    .bind(crypto.randomUUID(), id)
    .run();

  return c.json({ id }, 201);
});

items.patch('/items/:id', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const id = c.req.param('id');
  const projectId = await itemProjectId(c.env.DB, id);
  if (!projectId) return c.json({ error: 'not_found' }, 404);
  if (!(await projectBelongsToUser(c.env.DB, projectId, userId))) return c.json({ error: 'forbidden' }, 403);

  type UpdateItemBody = { name?: string; orderIndex?: number };
  const body = await c.req.json<UpdateItemBody>().catch(() => ({}) as UpdateItemBody);
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.name !== undefined) {
    sets.push('name = ?');
    binds.push(body.name);
  }
  if (body.orderIndex !== undefined) {
    sets.push('order_index = ?');
    binds.push(body.orderIndex);
  }
  if (!sets.length) return c.json({ error: 'nothing_to_update' }, 400);
  binds.push(id);
  const result = await c.env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

items.delete('/items/:id', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const id = c.req.param('id');
  const projectId = await itemProjectId(c.env.DB, id);
  if (!projectId) return c.json({ error: 'not_found' }, 404);
  if (!(await projectBelongsToUser(c.env.DB, projectId, userId))) return c.json({ error: 'forbidden' }, 403);

  const result = await c.env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

// A version's fields blob shape depends entirely on the item's item_key —
// the frontend owns that schema (matches ugc-vip-6stage.html's per-card
// field sets), this endpoint just stores whatever JSON object it's given.
items.patch('/items/:id/version', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const itemId = c.req.param('id');
  const projectId = await itemProjectId(c.env.DB, itemId);
  if (!projectId) return c.json({ error: 'not_found' }, 404);
  if (!(await projectBelongsToUser(c.env.DB, projectId, userId))) return c.json({ error: 'forbidden' }, 403);

  type MediaFile = { key: string; fileName: string; kind: string };
  type UpdateVersionBody = {
    fields?: Record<string, unknown>;
    prompt?: string;
    mediaFiles?: MediaFile[];
  };
  const body = await c.req.json<UpdateVersionBody>().catch(() => ({}) as UpdateVersionBody);

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (body.fields !== undefined) {
    sets.push('fields = ?');
    binds.push(JSON.stringify(body.fields));
  }
  if (body.prompt !== undefined) {
    sets.push('prompt = ?');
    binds.push(body.prompt);
  }
  if (body.mediaFiles !== undefined) {
    sets.push('media_files = ?');
    binds.push(JSON.stringify(body.mediaFiles));
  }
  if (!sets.length) return c.json({ error: 'nothing_to_update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(itemId);

  const result = await c.env.DB.prepare(
    `UPDATE item_versions SET ${sets.join(', ')} WHERE item_id = ? AND version_number = 1`
  )
    .bind(...binds)
    .run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

export default items;

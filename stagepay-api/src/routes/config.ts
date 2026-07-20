import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';

const config = new Hono<{ Bindings: Bindings }>();

// Stage prompt config (fieldsSchema, outputInstructions, universalStyle)
// lives in D1, not code — editing a row changes behavior with no redeploy.
// Used by the Setup-form/must-attach/Generate-modal rendering for Story,
// Scene, and Movie (Character/Property/Background/Sound no longer have a
// Setup form or Generate step — upload-only).
config.get('/config/:stage', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const stage = Number(c.req.param('stage'));
  if (!Number.isInteger(stage)) return c.json({ error: 'invalid_stage' }, 400);
  const row = await c.env.DB.prepare('SELECT config FROM stage_prompts WHERE stage = ?').bind(stage).first<{ config: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(JSON.parse(row.config));
});

export default config;

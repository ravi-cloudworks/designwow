import { Hono } from 'hono';
import type { Bindings } from '../lib/bindings';
import { currentUserId } from '../lib/bindings';

// Goal Tracker's data source — everything computed here is deliberately raw
// (every earnings_log entry, unaggregated) so the frontend can bucket it
// into "last 3 months" / "last 6 months" / whatever range it wants without
// another round trip. This is small enough (one row per confirmed payment)
// that shipping it all client-side is simpler than building a bucketing
// query for every possible window.
const earnings = new Hono<{ Bindings: Bindings }>();

earnings.get('/earnings/summary', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);

  const { results: entries } = await c.env.DB.prepare(
    `SELECT el.project_id, p.name as project_name, el.stage, el.amount_paise, el.paid_at
     FROM earnings_log el
     JOIN projects p ON p.id = el.project_id
     WHERE p.user_id = ?
     ORDER BY el.paid_at ASC`
  )
    .bind(userId)
    .all<{ project_id: string; project_name: string; stage: number; amount_paise: number; paid_at: string }>();

  const user = await c.env.DB.prepare(
    'SELECT goal_amount_paise, goal_set_at, stage_prices_paise, stage_target_counts FROM users WHERE id = ?'
  )
    .bind(userId)
    .first<{ goal_amount_paise: number; goal_set_at: string | null; stage_prices_paise: string; stage_target_counts: string }>();

  // How many stages a project of theirs typically completes, on average —
  // the correct denominator for "how many NEW projects do I need to start"
  // (see the Goal Tracker's Stage 1 count: summing raw stage counts
  // overcounts, since one project can cross Stage 1 once but complete
  // several later stages). Null with zero history — the frontend falls back
  // to a conservative "assume 1 stage per new project" default in that case,
  // and must say so explicitly rather than silently presenting a guess as fact.
  const distinctProjectIds = new Set(entries.map((e) => e.project_id));
  const historicalProjectCount = distinctProjectIds.size;
  const avgStagesPerProject = historicalProjectCount > 0 ? entries.length / historicalProjectCount : null;

  return c.json({
    entries: entries.map((e) => ({
      projectId: e.project_id, projectName: e.project_name, stage: e.stage,
      amountPaise: e.amount_paise, paidAt: e.paid_at,
    })),
    goalAmountPaise: user?.goal_amount_paise ?? 0,
    goalSetAt: user?.goal_set_at ?? null,
    stagePricesPaise: JSON.parse(user?.stage_prices_paise || '{}'),
    stageTargetCounts: JSON.parse(user?.stage_target_counts || '{}'),
    avgStagesPerProject,
    historicalProjectCount,
  });
});

// Re-setting the goal always restarts the 3-month window from now — it
// answers "starting today, what do I want to earn over the next 3 months",
// not "extend my old window's target". Stage target counts reset too (a
// manual allocation plan was built for the OLD goal, and stops making sense
// once the target itself changes) — but stage prices, a durable business
// fact about what this designer typically charges, are left untouched.
earnings.put('/earnings/goal', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const body = await c.req.json<{ amountPaise?: number }>().catch(() => ({}) as { amountPaise?: number });
  if (!body.amountPaise || body.amountPaise <= 0) return c.json({ error: 'amount_required' }, 400);

  await c.env.DB.prepare("UPDATE users SET goal_amount_paise = ?, goal_set_at = datetime('now'), stage_target_counts = '{}' WHERE id = ?")
    .bind(body.amountPaise, userId)
    .run();

  const saved = await c.env.DB.prepare('SELECT goal_amount_paise, goal_set_at FROM users WHERE id = ?')
    .bind(userId)
    .first<{ goal_amount_paise: number; goal_set_at: string }>();

  return c.json({ goalAmountPaise: saved?.goal_amount_paise ?? 0, goalSetAt: saved?.goal_set_at ?? null });
});

// Explicit clear, distinct from "set a different amount" — goes all the way
// back to no-goal-set, including the manual stage allocation built for it.
earnings.delete('/earnings/goal', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  await c.env.DB.prepare("UPDATE users SET goal_amount_paise = 0, goal_set_at = NULL, stage_target_counts = '{}' WHERE id = ?")
    .bind(userId)
    .run();
  return c.json({ ok: true });
});

// Durable — a designer's own typical price per stage doesn't reset when
// they set a new goal, unlike stage_target_counts above.
earnings.put('/earnings/stage-prices', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const body = await c.req.json<{ prices?: Record<string, number> }>().catch(() => ({}) as { prices?: Record<string, number> });
  if (!body.prices || typeof body.prices !== 'object') return c.json({ error: 'prices_required' }, 400);
  await c.env.DB.prepare('UPDATE users SET stage_prices_paise = ? WHERE id = ?')
    .bind(JSON.stringify(body.prices), userId)
    .run();
  return c.json({ ok: true });
});

earnings.put('/earnings/stage-counts', async (c) => {
  const userId = currentUserId(c);
  if (!userId) return c.json({ error: 'unauthenticated' }, 401);
  const body = await c.req.json<{ counts?: Record<string, number> }>().catch(() => ({}) as { counts?: Record<string, number> });
  if (!body.counts || typeof body.counts !== 'object') return c.json({ error: 'counts_required' }, 400);
  await c.env.DB.prepare('UPDATE users SET stage_target_counts = ? WHERE id = ?')
    .bind(JSON.stringify(body.counts), userId)
    .run();
  return c.json({ ok: true });
});

export default earnings;

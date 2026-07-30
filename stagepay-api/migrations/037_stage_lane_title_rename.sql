-- Renames the customer-facing stage labels (stage_prompts.config.laneTitle)
-- to match the new stage names used everywhere else in the app — this is
-- what pay.ts's stageLaneTitle() reads to build both the public payment
-- page's stage headers/UPI memo text AND downloaded deliverable filenames
-- (e.g. RK-projectx-2-story-board.png). A code-only rename elsewhere never
-- touches this — it's the one place the new names wouldn't reach without
-- an explicit data update. Stage 1 has no row here (always free, never
-- appears in payment_link_stages) so there's nothing to update for it.
UPDATE stage_prompts SET config = json_set(config, '$.laneTitle', 'Story & Script') WHERE stage = 2;
UPDATE stage_prompts SET config = json_set(config, '$.laneTitle', 'Creative Direction') WHERE stage = 3;
UPDATE stage_prompts SET config = json_set(config, '$.laneTitle', 'Production Blueprint') WHERE stage = 4;
UPDATE stage_prompts SET config = json_set(config, '$.laneTitle', 'Final Ad Delivery') WHERE stage = 5;

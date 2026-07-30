-- Story's own product being advertised was at risk of getting duplicated
-- as a brand-new Stage 3 property (e.g. "ProductX Bottle") whenever the
-- story text mentions it directly — even though Stage 1's product photos
-- already cover it and are already auto-attached wherever relevant
-- (mustAttachFiles). Nothing told Gemini to skip it before.
UPDATE stage_prompts
SET config = json_set(
  config,
  '$.items.story.content.autoPopulate.geminiResponseFields[1].shape', 'array of {name, description} — one entry per distinct physical object/prop, EXCLUDING the brand''s own core product being advertised (its bottle/package/box/container/etc.) — that''s already covered by the brief''s own product photos, never create a duplicate entry for it here; only extract OTHER, genuinely separate props/objects that appear in the story (furniture, incidental objects, accessories — anything distinct from the product itself). description must describe ONLY this object''s own fixed visual appearance (material, color, shape, size, condition, brand markings) as it would look alone on a plain background in a solo reference sheet — never mention any person, any other object, or what''s being done with it in a scene (e.g. write ''A tan leather three-seat sofa with rolled arms and wooden legs'', not ''a sofa where someone relaxes'').'
)
WHERE stage = 2;

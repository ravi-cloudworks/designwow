-- Scene's Flow prompt asked for ONE keyframe image; testing showed
-- Flow can reliably produce TWO separate images (a start frame and an end
-- frame of the described action, maintaining locked reference consistency)
-- when explicitly asked to. Updated OBJECTIVE/OUTPUT to request that pair
-- directly, matching the phrasing confirmed to work, so Stage 4's now
-- 2-image upload allowance has a matching pair of images to fill it.
UPDATE stage_prompts
SET config = json_set(
  config,
  '$.items.scene.outputInstructions[0].text', 'Create a premium Scene Blueprint based ONLY on the scene description provided below.

OBJECTIVE
Visualize the described scene as TWO SEPARATE images — a First/Start frame and a Last/End frame — capturing the beginning and the end of this scene''s action, so together they can anchor an 8-second animated clip in a later stage.
Generate photorealistic cinematic frames suitable for client approval before video production.
Do not invent story elements beyond what''s needed to show a natural start and end of the described action.

REFERENCE LOCK (critical)
Any Character, Property, or Background referenced below (by name, description, and attached reference image/file name) is APPROVED and LOCKED — this scene must depict them with the exact same face, body, outfit, colors, materials, and location/lighting/style already established for them. Do not redesign, restyle, or reinterpret any of them, even if this scene''s camera angle differs from their reference sheet. Reference each attached file by its exact file name so Flow knows which attachment applies to what.

STYLE
• Hollywood commercial frame
• Premium advertising photography
• Cinematic realism
• Feature-film lighting
• Luxury editorial presentation
• Cannes Lions quality

COMPOSITION
• Rule of thirds
• Leading lines
• Foreground/Midground/Background separation
• Natural depth
• Cinematic color grading
• Motivated lighting

DO NOT
Change story. Change any referenced character/prop/background''s established appearance. No cartoon, anime or comic styles. No text, captions, subtitles, labels, watermarks, or graphic overlays of any kind — these must be clean photographic frames with nothing printed on them, since these same images are later used as the reference frames for animating the Final Movie clip.

DIMENSIONS
Render at high resolution (minimum 1600px on the longest side), in the aspect ratio matching the target platform — vertical 9:16 for Reels/Shorts/TikTok, 16:9 for YouTube/landscape.

OUTPUT
Generate TWO SEPARATE images (not one combined sheet):
FRAME 1 (First / Start): the beginning of this scene''s action.
FRAME 2 (Last / End): the result/conclusion of this scene''s action.
Both frames must maintain perfect consistency with every referenced Character/Property/Background''s locked appearance (same face, body, outfit, colors, materials, location/lighting/style) — only the pose/action/expression changes between the two. Each is a clean photographic frame with no text, captions, or graphic overlays.'
)
WHERE stage = 4;

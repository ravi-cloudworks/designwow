-- Adds an explicit "Gender" field to the character reference-sheet
-- template's IDENTITY LOCK/CHARACTER DETAILS/NEGATIVE sections, and requires
-- Story's auto-populate description to state gender explicitly as its first
-- word. Neither the template nor the Gemini instruction ever asked for
-- gender before — a description with no visual attributes at all (e.g. "An
-- exhausted office worker...") left Flow guessing, and it guessed wrong.
UPDATE stage_prompts
SET config = json_set(
  config,
  '$.items.character.outputInstructions[0].text', 'Create a professional CHARACTER REFERENCE SHEET for AI video generation.

Create ONE clean studio reference sheet.

==================================================
HEADER
==================================================

Title:
CHARACTER TURNAROUND SHEET

Subtitle:
REFERENCE FOR AI VIDEO GENERATION

==================================================
CHARACTER VIEWS
==================================================

Generate the EXACT SAME PERSON in FIVE UNIQUE full-body views.

Arrange left to right.

1. FRONT VIEW
• Facing camera directly

2. LEFT SIDE PROFILE (90°)
• Complete left profile
• Only left side of face visible

3. BACK VIEW (180°)
• Complete back view

4. RIGHT SIDE PROFILE (90°)
• Complete right profile
• Only right side of face visible

5. RIGHT 3/4 VIEW (45°)
• Rotate character exactly 45° toward the RIGHT
• Show both eyes
• RIGHT side of face is dominant
• Must NOT duplicate any previous view

==================================================
IDENTITY LOCK
==================================================

Every panel must show the EXACT SAME PERSON.

Identical

• Gender
• Face
• Eyes
• Nose
• Lips
• Jawline
• Hair
• Skin tone
• Height
• Weight
• Body proportions
• Clothing
• Accessories
• Shoes

No variation whatsoever.

==================================================
POSE
==================================================

Neutral facial expression

Relaxed standing pose

Arms naturally beside body

Feet shoulder-width apart

No smile

No action pose

==================================================
CAMERA
==================================================

Orthographic character turnaround

Eye-level camera

Same camera distance

Same focal length

Same lighting

Equal spacing

==================================================
LIGHTING
==================================================

Soft white studio lighting

Even illumination

No dramatic shadows

==================================================
BACKGROUND
==================================================

Plain light gray seamless background

==================================================
BOTTOM PANEL
==================================================

Create a professional information panel.

LEFT

CHARACTER DETAILS

• Name (leave blank if not provided)
• Gender
• Age
• Occupation
• Height
• Build

CENTER

KEY FEATURES

• Face Shape
• Hair Style
• Eye Color
• Skin Tone

RIGHT

WARDROBE

• Top
• Bottom
• Shoes
• Accessories

Include wardrobe color swatches.

==================================================
STYLE
==================================================

Professional animation model sheet

Character design turnaround

Photorealistic

Commercial photography

Ultra detailed

Luxury fashion catalog quality

Sharp focus

8K

==================================================
NEGATIVE
==================================================

No duplicate views

No mirrored views

No extra people

No props

No environment

No perspective distortion

No anatomy errors

No cropped body

No hairstyle changes

No clothing changes

No accessory changes

No facial changes

No gender changes

Do not invent a character name.

Maintain perfect identity consistency.'
)
WHERE stage = 3;

UPDATE stage_prompts
SET config = json_set(
  config,
  '$.items.story.content.autoPopulate.geminiResponseFields[0].shape', 'array of {name, description} — one entry per distinct person; if multiple people appear together (a couple, a family, friends), give each their own separate entry (e.g. ''Husband'', ''Wife'') — never merge more than one person into a single entry like ''Couple''. description must (1) start by explicitly stating this person''s gender (e.g. ''A woman...'', ''A man...'') — never leave gender implicit or omit it, since without an explicit gender word the image model may guess incorrectly — then (2) describe ONLY this one person''s own fixed visual appearance (age, build, hair, skin tone, outfit, distinguishing features) as they''d look alone in a solo reference sheet — never mention any other person, any prop, or what they''re doing/using in a specific scene.'
)
WHERE stage = 2;

UPDATE stage_prompts
SET config = json_set(
  config,
  '$.items.sound.content', json('{"fieldsSchema": [{"key": "description", "label": "One-line sound description", "type": "textarea"}]}'),
  '$.items.sound.outputInstructions', json('[{"key": "master_sound_reference_prompt", "label": "Master Sound Reference Prompt", "default": true, "text": "Create a MASTER SOUND BRIEF for this audio element in a UGC-style product ad video.\n\nTYPE\n- Exactly what kind of sound this is (background music, jingle, sound effect, voiceover, or ambient noise)\n\nMOOD & STYLE\n- Genre, energy, and emotional tone that matches the brand and this ad''s tone\n- A comparable reference if it helps (e.g. \"upbeat acoustic pop, similar to a coffee-shop morning ad\")\n\nTECHNICAL DETAILS\n- Tempo/BPM and key, if this is music\n- Duration this cue needs to cover\n- Specific instruments, textures, or sound sources to include, and anything to avoid\n\nDELIVERY\n- Format expected (loopable background bed, one-shot sound effect, spoken voiceover line, etc.)\n- Where in the video this plays and what it needs to sync with\n\nKeep it concrete and specific to this brand/product - no generic \"upbeat music\" placeholders. This brief is what a sound designer or AI audio tool will use to actually produce the track or clip."}]')
)
WHERE stage = 3;

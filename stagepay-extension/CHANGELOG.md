# StagePay Director — Extension Changelog

Tracks what shipped in each Chrome Web Store submission, so it's clear what a
reviewer/user is actually getting in a given version and what's still queued
up for the next one.

**How to keep this current:** when you bump `manifest.json`'s `version` for a
new submission, add a dated section below for that version listing what
changed since the previous submission — move the "Unreleased" bullets under
it and clear "Unreleased" back out. Ask Claude to do this as part of the
release commit; it can reconstruct the list from `git log` if it falls behind.

## Unreleased

- Character now allows up to 2 uploaded images (previously capped at 1) —
  its master prompt now asks Flow for a full-body turnaround sheet plus a
  separate close-up face/expression sheet from one paste, so both need
  somewhere to land (8b23a31).
- Copying a Character/Property/Background/Sound prompt with a filled-in
  description now shows a confirm dialog first (description text + the
  brief's Target Audience for cross-reference) unless that exact text was
  already confirmed — catches cases like a description saying "woman" when
  the story actually specifies "Indian woman," easy to lose track of across
  several items.
- "No project detected" now names the signed-in email, so it's clear
  whether stagepay.pages.dev needs opening under a different account.
- Header (StagePay account, project, stage) is now sticky — stays visible
  while scrolling a long item list instead of scrolling away.

## 0.4.0 — 2026-07-31

- Gated the extension behind Director access — removed the old "StagePay-only"
  fallback mode entirely (56d797d).
- Connected-account status now names the actual signed-in email, not just
  "Connected" (5182c54, bfd16f4).
- Added the Director purchase flow and expiry banners for lapsed access
  (bfd16f4).
- Renamed the 5 swimlane stage labels to match the web app's new naming
  (Creative Brief / Story & Script / Creative Direction / Production
  Blueprint / Final Ad Delivery) (537a5b9).
- Fixed a bug where a scene's "Featured in this scene" references could
  silently freeze at whatever was picked the first time — both the reference
  thumbnails and the compiled Flow prompt now always reflect the current
  selection (537a5b9).
- The compiled prompt shown in Template mode is now always recomputed fresh
  instead of reusing a cached copy, so it can't fall behind changes made
  elsewhere (e.g. in the web app's refs picker) (537a5b9).
- Reference thumbnails now only show a copy button for files actually named
  in the compiled prompt; optional extras (storyboard, product photos) are
  shown dimmed/dashed with no copy button, since pasting them into Flow
  wouldn't match anything the prompt text says (537a5b9).
- "Enhance with ChatGPT" (Story/Scene/Movie) no longer forces a single
  guessed answer — it now sends the actual compiled prompt and invites a
  few clarifying questions before giving one improved version in a
  copyable code block. Added the same Flow/ChatGPT-enhance support to
  Sound (framed as a sound brief, not a Flow image prompt), matching
  Character/Property/Background. Renamed the button to "Enhance Prompt
  With ChatGPT" (ca9d1d6).
- Product photos now get a copy button on Scene reference thumbnails too
  (previously only the brand logo did) (32f4249).
- Movie items now have an editable "Scene description" field, pre-filled
  from the scene's own content and fed into the compiled prompt — previously
  the prompt only ever described camera movement, never what's actually
  supposed to happen or be said in the clip (ed602af).
- Scene now allows up to 2 uploaded images (previously capped at 1, same as
  Story) — a second keyframe gives Stage 5's clip generation a real
  start/end visual anchor for the motion (58bc7f6).
- Movie's compiled prompt now explicitly names a scene's Start/End frame
  images by role ("Start frame reference: X. End frame reference: Y.
  Animate the transition from the Start frame to the End frame...") instead
  of just listing filenames, so Flow has an explicit label to go by even
  after it renames the attached files (c76ca8f).

## 0.3.0 — 2026-07-29

- Renamed the extension to StagePay Director (from its working name); added
  the `/add-ons/director` landing page.
- Cross-syncs the extension and swimlane live — each refreshes when the
  other side changes data, including across multiple open windows/tabs.
- Added Template vs. Custom prompt modes; items collapse/expand; matches the
  swimlane's own upload rules (file kind, size, count per item type).
- Real video thumbnails with a video badge in the gallery.
- Setup/prompt now persist on Copy, "Enhance with ChatGPT," and Send — not
  only on an explicit Save.
- Downloads-folder connection is mandatory (blocking modal until connected);
  dropped the unused storage permission.
- Educational hover tooltips on every Scene/Movie pill option.
- Warns (rather than silently guessing) when multiple StagePay projects are
  open at once, consistently regardless of which tab is currently active.
- Blocking modal for upload validation errors (wrong file kind/too large),
  instead of a silent failure.
- Flow downloads now organize into per-project, per-item named folders.
- Storyboard/logo/product reference images shown consistently everywhere,
  with "See all" gallery views.

## 0.2.0 — 2026-07-24

- Full rebuild of the extension: Setup form, prompt compiler, and reference
  gallery moved out of the swimlane's old inline UI into the extension's own
  side-panel flow (a64087e).

## 0.1.0 — 2026-07-17

- Initial release — a Chrome side-panel extension for handing off compiled
  prompts/reference images to Google Flow (bf080e6).

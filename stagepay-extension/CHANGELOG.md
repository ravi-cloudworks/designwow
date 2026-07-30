# StagePay Director — Extension Changelog

Tracks what shipped in each Chrome Web Store submission, so it's clear what a
reviewer/user is actually getting in a given version and what's still queued
up for the next one.

**How to keep this current:** when you bump `manifest.json`'s `version` for a
new submission, add a dated section below for that version listing what
changed since the previous submission — move the "Unreleased" bullets under
it and clear "Unreleased" back out. Ask Claude to do this as part of the
release commit; it can reconstruct the list from `git log` if it falls behind.

## Unreleased (queued for 0.4.0 — do not submit until 0.3.0 is approved/published)

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

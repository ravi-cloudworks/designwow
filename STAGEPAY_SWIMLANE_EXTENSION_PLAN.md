# StagePay: Swimlane/Extension Split — Plan

Status: **agreed on design, not yet built.** Written up so this doesn't get lost
between sessions. There is exactly one beta user right now — this is the
safest possible moment to make a structural change like this, before more
people are depending on the current behavior. No need to protect existing
data for that user's sake — it can be cleaned/reset if needed — so nothing
below is gated on preserving their current state.

**Database change needed: exactly one, confirmed against the live D1
database (not just the local JSON files).** The `stage_prompts` row for
`stage = 3` currently has no `content`/`outputInstructions` for
`character`/`property`/`background` — just `{"label": "Character"}` etc.
Re-adding those three (not `sound` — no Flow prompt applies to audio) is a
plain `UPDATE` to that row's JSON, same pattern as the existing
`002_stage_prompts_seed.sql`/`003_stage_prompts_resync.sql` migrations — no
`ALTER TABLE`, no new column, no new table. Nothing else in this plan
touches D1: `current_stage` and the must-attach file list are already
returned by existing endpoints, `GET /api/config/:stage` already exists, and
the Phase 2 swimlane removal was already confirmed (see below) to touch
nothing the backend checks.

## The problem this solves

The swimlane currently mixes two things that don't belong on the same screen:

1. **"Is the deliverable here, has it been priced, has it been paid, can we
   move on"** — the actual job of StagePay (get paid every stage).
2. **"How do I produce this specific deliverable"** — Setup fields, a
   Generate button, a prompt textarea, Download-artifacts-as-zip, paste into
   Google Flow, download Flow's result, re-upload to StagePay.

(2) only ever applies to AI creators using Google Flow, and even for them
it's a real pain point independent of the confusion: today's actual path is
copy prompt → alt-tab → paste into Flow → generate → download the result →
find it in Downloads → alt-tab back → find the right item → upload. Two
separate file-shuffling round trips for one piece of work. Meanwhile a
filmed/self-recording creator (records themselves, never touches Flow) sees
all of this UI and has to figure out none of it is for them.

## The four prompt templates (source: user's own RTF files on Desktop)

`character-prompt.rtf`, `prop-prompt.rtf`, `background-prompt.rtf`,
`storyboard-prompt.rtf` — all follow one shape: a large fixed template +
exactly one variable line the human supplies (a one-line description of the
character/prop/background; the scene list for storyboard). This is the same
shape StagePay's own `compilePrompt()` + `composeFinalPrompt()` already use
for Story/Scene/Movie (`stagepay-prompts/stage2.json` etc. —
masterSheetPrompt + yourDescription + universalStyle). Nothing new needs
inventing mechanically — these three templates just need to exist as
`content`/`outputInstructions` for `character`/`property`/`background` again
(they were stripped from `stagepay-prompts/stage3.json` in an earlier pass
that removed Gemini-based Setup, which is a separate concern from "a human
types one line and a fixed template wraps it").

One content note, separate from the UX work: the user's `storyboard-prompt`
auto-derives Shot Type/Camera Angle/Movement per panel; the app's current
Master Storyboard Prompt deliberately forbids inventing camera angle. Decide
this later, independently of everything below.

## The agreed final architecture

**No project-level toggle.** Earlier drafts of this plan considered an
"AI creator vs. filmed creator" flag on the project — superseded. Instead:

- **The swimlane becomes identical for every user, every item type.** Name +
  upload widget + set amount + confirm paid + lock + move to next stage.
  Nothing else. This is already exactly what Character/Property/Background/
  Sound look like today — it becomes the universal shape for Story/Scene/
  Movie too.
- **All Setup fields, prompt compilation, and Google Flow round-tripping move
  into the `stagepay-extension` Chrome side panel**, for whichever stage is
  currently open. A filmed creator simply never opens the extension (or, if
  they do, can use it purely as a fast drag-drop-upload shortcut and ignore
  the rest — nothing stops them). An AI creator lives in the extension next
  to their Google Flow tab.
- **Character/Property/Background gain their one-line-description → Flow
  prompt back — inside the extension only, never in the swimlane.** Sound
  stays pure upload everywhere (it's real audio, no Flow prompt makes sense
  for it — don't build one).
- **"Featured in this scene" stays in the swimlane, untouched.** It's a
  structural/continuity decision (which real, already-approved items belong
  to this scene — matters for wardrobe/prop continuity even when filming for
  real, not just an AI-consistency aid), already has its own small standalone
  modal separate from the big Setup form, and needs no relocation.
- **"Open in ChatGPT" (already built, `buildItemChatGptPrompt()`) also lives
  in the extension going forward**, as one more production path alongside
  Flow — useful for a filmed creator who wants a written shot list without
  ever generating an AI image. This is why the swimlane never needs to ask
  "which kind of creator are you" — the extension is where *any* production
  method lives, Flow or ChatGPT or neither.

## Why this is safe to build (code audit already done)

Traced every call site in `stagepay-web/index.html` before agreeing to this:

- Everything moving out (`openGenerateModal`/`renderGenerateModal`,
  `compilePrompt`, `composeFinalPrompt`, `buildItemChatGptPrompt`,
  `describeItemForRef`, `renderFieldsForm`, `downloadItemPackage`/`buildZip`/
  `slugify`, the Generate/Upload mode toggle and its `_uiMode` state) is
  self-contained — confirmed nothing outside this cluster calls into any of
  it.
- **Backend lock validation** (`POST /:id/stages/:stage/lock` in
  `stagepay-api/src/routes/projects.ts`) only checks for an uploaded file +
  a paid amount. It never checks `prompt` or `fields` completeness. Removing
  Setup/Generate from the swimlane cannot make any stage unlockable.
- **Moodboard and Showcase** screens only ever read `media_files`, never
  `.prompt` or Setup `fields`. Unaffected.
- `state.stageConfigs` (the `GET /api/config/:stage` fetch) has to stay
  regardless — `itemLabel()` (item display names everywhere, e.g.
  "Character", "Scene") depends on it independently of Setup forms.
- `GET /api/config/:stage` (in `stagepay-api/src/routes/config.ts`) already
  returns exactly the JSON — fieldsSchema, outputInstructions,
  universalStyle, assemblyOrder — the extension needs. **No new backend
  route required** for the extension to gain Setup rendering + prompt
  compilation.

## What NOT to touch

- `stage_prompts` table shape, `item_versions.fields`/`prompt` columns —
  unchanged. This is a pure UI-relocation, not a data-model change.
- The upload flow itself (`POST /api/media`, `PATCH /api/items/:id/version`)
  — unchanged, same calls the extension already makes today.
- Payment/lock/amount logic anywhere — unchanged.
- The old grid showcase page precedent is the model to follow for the risky
  swimlane change: **don't delete the Generate-modal code, just stop
  routing to it** (exactly like `renderPublicShowcasePage` was left fully
  defined but unrouted when the swipe page became default). Trivially
  reversible if something's wrong — repoint one `if`/one button instead of
  rebuilding from scratch.

## Things we need to do — in order

**Phase 0 — done.** This document.

**Phase 1 — extension changes — DONE, built and deployed to D1/local files.**
(isolated, zero risk to the live app the beta user currently sees;
`stagepay-extension` is a separate codebase the web app doesn't depend on):

1. ✅ Dropped the 5-stage tab nav. The panel now defaults to whatever
   `current_stage` already is, reusing the field `GET /api/projects` already
   computes — no new sync channel needed. (`panel.js`, `panel.html`)
2. ✅ Panel now shows each item's *must-attach reference images* (the inputs
   it needs — `mustAttachFiles()` ported into `panel.js`), separately from
   the item's own already-uploaded output (`media_files`), which still
   renders too (relabeled "Deliverable").
3. ✅ Panel fetches `GET /api/config/:stage` and renders that stage's
   `fieldsSchema` as an actual editable form (text/textarea/pill, with
   presets) — a "Setup" section per item, only shown when that item type
   actually has a Flow prompt (`hasFlowPrompt()`).
4. ✅ `compilePrompt()` / `composeFinalPrompt()` ported into `panel.js` —
   "🪄 Compile" builds the prompt locally, "💾 Save" persists `{fields,
   prompt}` together via the existing `PATCH /api/items/:id/version` (confirmed
   the route already accepts both — no backend change needed for this part).
5. ✅ Character/Property/Background regained their one-line-description →
   Flow-prompt, sourced from the four RTF templates. Migration
   `031_stage3_flow_prompts.sql` applied to the live D1 database — the only
   database change in this whole plan, confirmed additive: `stage_prompts`
   row for `stage = 3` now carries `content`/`outputInstructions` for those
   three items; `sound` untouched (`{"label": "Sound"}`, no prompt — it's
   real audio). `stagepay-prompts/stage3.json` updated to match (source of
   truth kept in sync with D1, same convention as every other stage file).
6. ✅ "Open in ChatGPT" ported in as `buildChatGptMetaPrompt()` — opens via
   `chrome.tabs.create` (the `tabs` permission was already granted).
7. N/A — there was never a zip-download feature in the extension to begin
   with (that was a web-app-only feature, `downloadItemPackage`/`buildZip`);
   nothing to drop here.

Also fixed one thing along the way not originally itemized: Setup text/
textarea inputs now update the in-memory draft on `input` (every keystroke)
rather than `change` (on blur) — clicking a pill button elsewhere re-renders
the whole stage view, and `change` would have silently discarded whatever
was mid-typed and not yet blurred in another field at that moment.

**Addendum — Downloads-folder friction (added after Phase 1's initial
build, same session):** the original ask was to also cut the remaining
"go dig through Downloads" pain. Investigated an Erasio-style approach
(inject a button directly onto Flow's page) — rejected, since it reverses
the documented decision in `background.js` to avoid an always-on presence
on Flow's page (bigger permission ask, tied to Flow's page structure which
can change without notice, plus Erasio's own watermark-removal feature
sits in a real Google ToS gray area we don't need anyway).

First pass at a lighter fix: `chrome.downloads` permission + a read-only
filename/time-ago list, plus a multi-select file picker with local staging.
Built, then **superseded within the same session** — a secondhand Chromium
bug report said `showDirectoryPicker()` "fails in extensions," which turned
out to only be true for extension *popups* (they auto-close the instant the
OS folder dialog steals focus, killing the in-flight promise — a side panel
doesn't have that problem). Verified this live: added a temporary test
button to the actual loaded side panel, clicked it, got
`✅ SUCCESS — granted access to folder`. Don't trust a secondhand bug report
over a live test in the actual target surface — this was the one point in
the whole plan where that distinction mattered.

**What's actually built now (still no backend changes, `downloads`
permission removed again since it's no longer used):**
- One-time "🔗 Connect downloads folder" button, in each item's Deliverable
  section. The granted `FileSystemDirectoryHandle` is stored in IndexedDB
  (structured-cloneable, unlike `chrome.storage`) so it survives the panel
  closing/reopening — only the OS permission needs silently re-confirming
  per browser session (`queryPermission`), with a "🔓 Reconnect" fallback if
  it lapsed.
- Once connected, every item's Deliverable section shows a real thumbnail
  gallery (genuine file bytes, not just names) of the most recent
  image/video files in that folder — click a thumbnail to stage it for
  *that* item (reuses the exact same staging/send mechanism the multi-file
  picker already uses — the gallery is just a third way to populate it,
  not a separate pipeline).
- The multi-select file picker/dropzone stays as the fallback for anyone
  who'd rather not grant folder access.
- One real limit, unchanged from before: Chrome still won't let the
  extension read a file's bytes from a bare path string — folder access has
  to be an explicit, visible grant. That's the actual ceiling here, not a
  bug to keep chasing.

**Follow-on gap found during testing:** `showDirectoryPicker()` refuses
Downloads/Desktop/Documents/home directly — Chrome deliberately blocks
granting a "sensitive" top-level directory. So Flow's downloads kept landing
in the ordinary Downloads folder no matter what subfolder the panel was
connected to. Two options: (1) change Chrome's global default download
location to match the connected folder — zero code, but affects every site's
downloads, not just Flow's; (2) built instead — `chrome.downloads
.onDeterminingFilename` in `background.js` auto-redirects only downloads
whose referrer matches Flow's own domain (`labs.google`, confirmed from the
user's own Chrome download history, not guessed) into a `StagePayBridge/`
subfolder inside Downloads. A subfolder isn't a blocked top-level directory,
so the panel can be connected to exactly that one — everything else
downloaded in the browser is untouched. `downloads` permission re-added to
`manifest.json` for this (it was removed once already when the earlier
`chrome.downloads.search()` list got superseded — this is a legitimately
different use of the same permission).

**Not yet done, worth a pass before calling Phase 1 fully finished:** a full
live walkthrough of the finished gallery flow (connect → download something
→ rescan → click a thumbnail → send) — the folder-access grant itself was
verified live, but the gallery/staging integration built on top of it has
only been code-reviewed and syntax-checked (`node --check`), not
click-tested end to end yet.

**Phase 2 — swimlane simplification (only after Phase 1 is built and
tried on the beta user's own real project, so nobody loses the ability to
produce a deliverable mid-transition):**

1. Remove the Generate/Upload mode toggle from `renderNumberedItemCard` and
   from Story's own card — every item type renders the plain upload-only
   view (`assetOnlyStep`-equivalent) unconditionally.
2. Stop routing to `openGenerateModal` — remove the buttons that call it
   (`data-open-generate`, the mode-toggle buttons, Story's own equivalents).
   Leave `openGenerateModal`/`renderGenerateModal`/`compilePrompt`/
   `composeFinalPrompt`/`buildItemChatGptPrompt`/`describeItemForRef`/
   `renderFieldsForm`/`downloadItemPackage`/`buildZip`/`slugify` fully
   defined in the code, just unreachable — same "keep it but not reachable"
   pattern already used for the old grid showcase page. Don't delete
   anything in this first pass.
3. Leave "Featured in this scene" (`openSceneRefsModal`, the standalone
   modal, the swimlane's "Featured: X, Y" note) completely untouched.
4. Verify: `node --check` on the extracted script, then a full manual
   walkthrough of all 5 stages on the beta user's actual project before
   deploying — upload a file, set an amount, confirm paid, lock, for at
   least one item of each type.

**Phase 3 — optional courtesy heads-up to the beta user.** Not a hard gate
(their data doesn't need protecting) — just a nice-to-have since the UI they
see will visibly change.

## Open questions, deliberately not decided yet

- Storyboard content difference (auto camera-angle-per-panel vs. today's
  "don't invent camera angle" rule) — decide separately from this UI work.
- Whether Stage 4 (Scene Blueprint) makes sense unchanged for a filmed
  creator, or should be reframed/skippable — raised earlier, not resolved,
  not blocking this plan (Scene stays a normal upload-only swimlane item
  either way).
- **Where a saved prompt/Setup becomes visible once Phase 2 removes
  Generate/Setup/prompt UI from the swimlane.** Today (pre-Phase 2), a
  prompt saved via the extension is still visible in the swimlane's own
  Generate modal, since both read/write the same `item_versions.prompt`/
  `fields` columns. The extension itself only ever shows the *current*
  stage's items — once a stage locks, its items drop out of the
  extension's view entirely. So today there's still a fallback place to
  check an old prompt (the swimlane's modal); after Phase 2 removes that
  modal, a saved prompt for anything outside the current stage becomes
  invisible in *both* places at once, even though it's still sitting in the
  database. Needs a real answer before Phase 2 ships — e.g. some read-only
  view of past prompts, reachable from either surface, for a stage that's
  already locked. Explicitly deferred — revisit when Phase 2 actually
  starts, not decided now.

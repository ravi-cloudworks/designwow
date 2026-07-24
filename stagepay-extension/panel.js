// StagePay Bridge — side panel logic.
// This talks ONLY to stagepay-api (via the stagepay.pages.dev proxy, same
// endpoints the web app itself uses) and to a user-granted local folder (via
// the File System Access API — see connectDownloadsFolder/scanDownloadsFolder)
// for real thumbnails of recently downloaded Flow output. It never touches
// Google Flow's page directly.
//
// showDirectoryPicker() was initially assumed broken in all extension
// contexts, per a Chromium bug report — but that report was specifically
// about extension POPUPS, which auto-close the instant the OS folder dialog
// steals focus, killing the in-flight promise. A side panel doesn't close
// like that — confirmed working here via a live test, not a guess.
//
// Auth model: no separate login here at all. If you're logged into StagePay
// in a normal browser tab, this panel's fetch() calls reuse that same
// session cookie (credentials: 'include' + the host_permission in
// manifest.json is what makes that work). If you're not logged in, the API
// calls below will come back 401 and the panel will just tell you so.
//
// Role split (see STAGEPAY_SWIMLANE_EXTENSION_PLAN.md): the swimlane in the
// main web app is income-focused only (upload the deliverable, set the
// amount, get paid, lock, move on) — identical for every user. This panel
// is where the deliverable actually gets PRODUCED: Setup fields, a compiled
// Flow-ready (or ChatGPT-ready) prompt, and pushing the result straight back
// as the deliverable. Nobody has to declare "I'm an AI creator" anywhere —
// a filmed creator just never opens this panel, or uses it only for its
// drag-drop-upload shortcut and ignores the rest.

const API_BASE = 'https://stagepay.pages.dev';
const STAGE_NAMES = { 1: 'Brief', 2: 'Story Board', 3: 'Visual & Music', 4: 'Scene Blueprint', 5: 'Final Movie' };

let currentProjectId = null;
let currentProjectName = '';
let currentBrief = null;
let currentItems = [];
let currentStage = null; // from GET /api/projects (list) — "the next thing to actually do", not a manually-picked tab
let currentCompleted = false;
const stageConfigCache = {}; // { [stage]: parsed config JSON from GET /api/config/:stage }
const itemDrafts = {}; // { [itemId]: { fields, prompt } } — in-memory only until "Save"
const stagingFiles = {}; // { [itemId]: File[] } — picked/dropped but not yet sent to StagePay
const stagingNotes = {}; // { [itemId]: string | null } — must be real state, not an imperative DOM mutation: addToStaging calls render() right after setting it, which rebuilds the whole card from scratch and would otherwise wipe out a one-off element mutation immediately
let lastCopied = null; // { kind: 'prompt' | 'image', label, preview, copiedAt } — the single most recent copy, not a history

// One granted folder, shared across every item — the browser has no idea
// which StagePay item a downloaded file is "for," so there's exactly one
// gallery, and the user clicks whichever thumbnail belongs where.
let downloadsDirHandle = null;
let folderPermissionState = 'none'; // 'none' | 'granted' | 'needs-reconnect'
let folderThumbnails = []; // [{ name, file, url }] — most recent first
const FOLDER_GALLERY_LIMIT = 16;
const FOLDER_GALLERY_MIME_PREFIXES = ['image/', 'video/'];
// Must match FLOW_DOWNLOADS_SUBFOLDER in background.js — not shared code
// (separate execution contexts), just kept in sync by hand. Only used here
// to tell the user what to look for in the picker; background.js is the
// one actually creating/naming the folder.
const FLOW_DOWNLOADS_SUBFOLDER_HINT = 'StagePayBridge';

const statusEl = document.getElementById('projectStatus');
const itemListEl = document.getElementById('itemList');
const lastCopiedSectionEl = document.getElementById('lastCopiedSection');
const lastCopiedContentEl = document.getElementById('lastCopiedContent');

// ---------- last-copied strip (unchanged) ----------
function setLastCopied(entry) {
  lastCopied = { ...entry, copiedAt: Date.now() };
  renderLastCopied();
}
function renderLastCopied() {
  if (!lastCopied) { lastCopiedSectionEl.hidden = true; return; }
  lastCopiedSectionEl.hidden = false;
  const time = new Date(lastCopied.copiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (lastCopied.kind === 'image') {
    lastCopiedContentEl.innerHTML = `
      <div class="copied-row">
        <img src="${lastCopied.preview}">
        <div style="flex:1"><strong>🖼 ${escapeHtml(lastCopied.label)}</strong><p>Image — ready to paste</p></div>
        <time>${time}</time>
      </div>`;
  } else {
    lastCopiedContentEl.innerHTML = `
      <div class="copied-row">
        <span class="copied-icon">📋</span>
        <div style="flex:1"><strong>Prompt — ${escapeHtml(lastCopied.label)}</strong><p>${escapeHtml((lastCopied.preview || '').slice(0, 140))}</p></div>
        <time>${time}</time>
      </div>`;
  }
}

async function init() {
  await refreshFromActiveTab();
  // The panel only detects the project once when it opens — it never
  // notices the SAME tab navigating to a different project afterward
  // (StagePay is a single-page app, so this is a URL change with no full
  // reload). Re-check whenever the tab's URL changes or focus switches tabs,
  // plus a manual button for whenever that misses something.
  //
  // Two separate triggers, covering two separate real setups — both force a
  // real refetch even for the SAME project, since switching back is exactly
  // the moment something (e.g. a manual swimlane upload) may have changed:
  //   - onActivated: StagePay and Flow/ChatGPT are tabs in the SAME window —
  //     switching tabs within one window doesn't change which window has OS
  //     focus, so onFocusChanged wouldn't fire here.
  //   - windows.onFocusChanged: the side panel's own window is a SEPARATE
  //     top-level Chrome window from wherever StagePay's tab actually lives —
  //     switching windows never changes which tab is active in either one,
  //     so onActivated wouldn't fire here; only window-level focus does.
  // Neither catches the panel sitting open right next to an already-active
  // StagePay tab with no window/tab-switching involved — the manual 🔄
  // button covers that.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) refreshFromActiveTab();
  });
  chrome.tabs.onActivated.addListener(() => refreshFromActiveTab(true));
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return; // focus left Chrome entirely — nothing to refetch yet
    refreshFromActiveTab(true);
  });
  document.getElementById('refreshBtn').addEventListener('click', () => refreshFromActiveTab(true));
  await tryRestoreDownloadsFolder();
}

async function refreshFromActiveTab(force) {
  const projectId = await detectOpenProjectId();
  if (!projectId) {
    statusEl.textContent = 'No StagePay project tab found — open a project at stagepay.pages.dev, then reopen this panel.';
    statusEl.className = 'status error';
    currentProjectId = null;
    itemListEl.innerHTML = '';
    updateStageBanner();
    return;
  }
  if (projectId === currentProjectId && !force) return; // already showing this one
  currentProjectId = projectId;
  await loadProject();
  render();
}

// The web app already puts the open project's id in the URL as ?p=<id>
// (added for its own refresh-persistence) — reading that is simpler and
// more robust than trying to scrape the page for it. Prefers the tab that's
// actually focused right now, since scanning "any StagePay tab" could
// otherwise grab a different, unrelated project if more than one is open.
async function detectOpenProjectId() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab && activeTab.url && activeTab.url.startsWith(API_BASE)) {
    const p = new URL(activeTab.url).searchParams.get('p');
    if (p) return p;
  }
  const tabs = await chrome.tabs.query({ url: `${API_BASE}/*` });
  for (const tab of tabs) {
    if (!tab.url) continue;
    const p = new URL(tab.url).searchParams.get('p');
    if (p) return p;
  }
  return null;
}

// Loads: (a) the project list, purely to read this one project's
// current_stage/completed — the same "highest locked stage, +1 if locked"
// formula GET /api/projects already computes server-side, reused instead of
// re-implemented; (b) the project detail (brief + items + versions); (c)
// that stage's config (fieldsSchema/outputInstructions/universalStyle), if
// not already cached.
async function loadProject() {
  const [listRes, detailRes] = await Promise.all([
    fetch(`${API_BASE}/api/projects`, { credentials: 'include' }),
    fetch(`${API_BASE}/api/projects/${currentProjectId}`, { credentials: 'include' }),
  ]);
  if (listRes.status === 401 || detailRes.status === 401) {
    statusEl.textContent = 'Not logged in — log into StagePay in a normal tab first, then reopen this panel.';
    statusEl.className = 'status error';
    currentItems = [];
    return;
  }
  if (!listRes.ok || !detailRes.ok) {
    statusEl.textContent = `Could not load project (${listRes.status}/${detailRes.status}).`;
    statusEl.className = 'status error';
    currentItems = [];
    return;
  }
  const listData = await listRes.json();
  const meta = (listData.projects || []).find((p) => p.id === currentProjectId);
  currentStage = meta ? meta.current_stage : 1;
  currentCompleted = !!(meta && meta.completed);

  const detail = await detailRes.json();
  currentBrief = detail.brief || null;
  currentItems = detail.items || [];
  currentProjectName = (detail.project && detail.project.name) || 'this project';

  if (!currentCompleted && currentStage >= 2 && !stageConfigCache[currentStage]) {
    try {
      const cfgRes = await fetch(`${API_BASE}/api/config/${currentStage}`, { credentials: 'include' });
      if (cfgRes.ok) stageConfigCache[currentStage] = await cfgRes.json();
    } catch (e) { /* fine — falls back to upload-only rendering below */ }
  }

  statusEl.textContent = 'Connected'; // project + stage now live once, in the stage banner below — no need to repeat it here
  statusEl.className = 'status ok';
}

function itemById(id) { return currentItems.find((i) => i.id === id) || null; }
function theVersion(item) { return (item && item.versions && item.versions[0]) || { prompt: '', media_files: [], fields: {} }; }
function itemConfigFor(item) {
  const sc = stageConfigCache[item.stage];
  return (sc && sc.items && sc.items[item.item_key]) || null;
}
function hasFlowPrompt(item) {
  const ic = itemConfigFor(item);
  return !!(ic && ic.outputInstructions && ic.outputInstructions.length);
}
// Mirrors index.html's own per-type caps exactly — every item type is
// capped at exactly 1 file except Story (STORY_MAX_FILES = 2 there). The
// web app enforces this by hiding its upload button once at capacity; the
// extension has no such button to hide, so it has to check explicitly.
function maxFilesFor(item) { return item.item_key === 'story' ? 2 : 1; }

// Mirrors index.html's DEFAULT_MEDIA_MAX_MB/MEDIA_MAX_MB/maxUploadMb/
// checkFileSize exactly — the backend's own 100MB cap (media.ts) is a
// type-blind absolute backstop, not a substitute for these tighter,
// per-item-type limits (a 50MB Character image should never reach the
// server at all, the same way the swimlane itself would block it).
const DEFAULT_MEDIA_MAX_MB = 20;
const MEDIA_MAX_MB = { movie: 100 };
function maxUploadMb(itemKey) { return MEDIA_MAX_MB[itemKey] || DEFAULT_MEDIA_MAX_MB; }
function checkFileSize(file, maxMb) { return file.size <= maxMb * 1024 * 1024; }

// Mirrors index.html's MEDIA_ACCEPT map exactly: Sound is audio-only,
// Movie/Final Video are video-only, everything else (Story included) is
// image-only. Used both for the file input's own `accept` attribute (a
// soft hint — native pickers can still be told to show "all files", and
// it does nothing at all for drag-and-drop) and, more importantly, for a
// real check in addToStaging below, since that's the one gate every path
// — picker, drop, and the downloads-folder gallery — actually goes through.
const MEDIA_ACCEPT = { sound: 'audio/*', movie: 'video/*', final_video: 'video/*' };
function mediaAcceptFor(itemKey) { return MEDIA_ACCEPT[itemKey] || 'image/*'; }
function requiredKindFor(itemKey) {
  if (itemKey === 'sound') return 'audio';
  if (itemKey === 'movie' || itemKey === 'final_video') return 'video';
  return 'image';
}
function fileKindOf(file) {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  return 'other';
}

// Mirrors index.html's cleanUploadFileName exactly — Flow's own downloaded
// filenames are long and ugly (e.g. "image.png_2K_202607241152.jpeg"); this
// renames to something clean based on the item's own name, same as every
// upload already gets in the swimlane.
function cleanUploadFileName(item, originalFileName, existingCount) {
  const extMatch = originalFileName.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'dat';
  const ic = itemConfigFor(item);
  const base = (item.name || (ic && ic.label) || item.item_key)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'file';
  const suffix = existingCount > 0 ? `-${existingCount + 1}` : '';
  return `${base}${suffix}.${ext}`;
}
function draftFor(item) {
  if (!itemDrafts[item.id]) {
    const v = theVersion(item);
    itemDrafts[item.id] = { fields: JSON.parse(JSON.stringify(v.fields || {})), prompt: v.prompt || '' };
  }
  return itemDrafts[item.id];
}

// The backend's one `prompt` column always reflects whichever mode is
// currently active — Custom's own text stays preserved in
// fields._customPrompt regardless, so switching back to Template later
// still shows the compiled view, not a stale Custom save.
function currentPromptFor(item) {
  const draft = draftFor(item);
  const mode = draft.fields._uiMode === 'custom' ? 'custom' : 'template';
  return (mode === 'custom' ? draft.fields._customPrompt : draft.prompt) || '';
}

// Shared by Save, Copy prompt, "Enhance with ChatGPT", and Send — every
// moment that actually uses the current Setup/prompt now persists it too,
// not just the one explicit Save button.
async function saveItemDraft(item) {
  const draft = draftFor(item);
  const promptVal = currentPromptFor(item);
  await fetch(`${API_BASE}/api/items/${item.id}/version`, {
    method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: draft.fields, prompt: promptVal }),
  });
  const v = theVersion(item);
  v.fields = draft.fields;
  v.prompt = promptVal;
}

// Same idea as the web app's mustAttachFiles — "every file this item needs
// ALREADY attached as visual input before generating," not this item's own
// (not-yet-produced) output. Kept in exact parity with index.html's version
// so a Scene/Movie's reference list here always matches what the web app
// itself would show.
function mustAttachFiles(item, fields) {
  const b = currentBrief || {};
  const logoFiles = () => (b.logo_media && b.logo_media.key ? [{ ...b.logo_media, icon: '🏷️' }] : []);
  const productFiles = () => (b.product_photos || []).map((p) => ({ ...p, icon: '📷' }));
  const itemMediaFiles = (it) => (theVersion(it).media_files || []);
  const withIcon = (files, icon) => files.map((f) => ({ ...f, icon: f.icon || icon }));

  if (item.item_key === 'story') return [...logoFiles(), ...productFiles()];
  if (item.item_key === 'character') return logoFiles();
  if (item.item_key === 'property') return [...logoFiles(), ...productFiles()];
  if (item.item_key === 'background') return logoFiles();
  if (item.item_key === 'scene') {
    const refIds = Array.isArray(fields.refs) ? fields.refs : [];
    const refFiles = refIds.flatMap((id) => { const ref = itemById(id); return ref ? withIcon(itemMediaFiles(ref), '') : []; });
    return [...refFiles, ...logoFiles()];
  }
  if (item.item_key === 'movie') {
    const scene = itemById(item.parent_item_id);
    const sceneFields = scene ? (theVersion(scene).fields || {}) : {};
    const refIds = Array.isArray(sceneFields.refs) ? sceneFields.refs : [];
    const refFiles = refIds.flatMap((id) => { const ref = itemById(id); return ref ? withIcon(itemMediaFiles(ref), '') : []; });
    const soundFiles = currentItems.filter((i) => i.stage === 3 && i.item_key === 'sound').flatMap((s) => withIcon(itemMediaFiles(s), '🔊'));
    return [...(scene ? withIcon(itemMediaFiles(scene), '🎬') : []), ...refFiles, ...soundFiles];
  }
  return [];
}

// A compact one-line description of a Character/Property/Background/Sound
// item, for a Scene to repeat as text alongside naming it — mirrors
// index.html's describeItemForRef exactly: prefer the item's own stored
// description (written by Story's auto-populate sync, or typed directly
// into its one-line description field), fall back to a generic
// "don't reinterpret this" note for an item created with no description.
function describeItemForRef(refItem) {
  const rf = theVersion(refItem).fields || {};
  if (rf.description && rf.description.trim()) return rf.description.trim();
  return 'the approved reference image — replicate this exact appearance, do not redesign or reinterpret it';
}

// ---------- prompt compilation — mirrors index.html's compilePrompt exactly,
// plus the new character/property/background cases (031_stage3_flow_prompts) ----------
function compilePrompt(item, fields) {
  const f = fields || {};
  let base;
  switch (item.item_key) {
    case 'story': {
      const b = currentBrief || {};
      const colors = [b.brand_color_primary, b.brand_color_secondary, b.brand_color_accent].filter(Boolean).join(', ');
      const instruction = `Generate ONE combined storyboard reference image (not separate images) from the story direction below, composed as a sequential multi-panel layout (comic-strip/contact-sheet style) covering the key beats. Render as real photography — not an illustration, sketch, or cartoon.${colors ? ` Grade it in the brand colors (${colors}).` : ''} Embed the logo and product photos naturally into whichever panels they belong in (packaging, signage, a phone screen, etc.), not pasted on as separate graphics.`;
      base = `${instruction}\n\n${b.tone || '(tone)'} storyline: ${b.storyboard || '(storyboard)'}`;
      break;
    }
    case 'character':
    case 'property':
    case 'background':
      base = f.description || '';
      break;
    case 'scene': {
      const refItems = (f.refs || []).map((r) => itemById(r)).filter(Boolean);
      const refLine = refItems.length
        ? ` Featuring (already approved and locked — replicate their appearance exactly as described, do not redesign or reinterpret them): ${refItems.map((it) => `${it.name} (${describeItemForRef(it)})`).join('; ')}.`
        : '';
      base = `${f.location || '(location)'}. ${f.action || '(action)'} Emotion: ${f.emotion || '(emotion)'}. Dialogue: "${f.dialogue || '(no dialogue)'}".${refLine} Shot: ${f.type || '(shot type)'} on ${f.camera || '(camera)'}, ${f.lens || '(lens)'} lens, ${f.camera_angle || '(camera angle)'}.`;
      break;
    }
    case 'movie':
      base = `Animate the approved shot into a ${f.duration || 8}-second clip: ${f.direction || '(direction)'}.${f.broll && f.broll !== 'None' ? ` B-roll: ${f.broll}.` : ''} Transition: ${f.transition || 'Hard Cut'}.`;
      break;
    default:
      base = '';
  }
  const files = mustAttachFiles(item, f);
  const refLine = files.length ? ` Reference images: ${files.map((x) => x.fileName).join(', ')}.` : '';
  return `${base}${refLine}`;
}

function composeFinalPrompt(item, contentText) {
  const sc = stageConfigCache[item.stage];
  const ic = sc && sc.items && sc.items[item.item_key];
  if (!sc || !ic || !ic.outputInstructions || !ic.outputInstructions.length) return contentText;
  const master = (ic.outputInstructions.find((o) => o.default) || ic.outputInstructions[0]).text;
  const pieces = { masterSheetPrompt: master, yourDescription: contentText, universalStyle: (sc.universalStyle && sc.universalStyle.text) || '' };
  const order = sc.assemblyOrder || ['masterSheetPrompt', 'yourDescription', 'universalStyle'];
  return order.map((k) => pieces[k]).filter(Boolean).join('\n\n+\n\n');
}

function briefSummary() {
  const b = currentBrief;
  if (!b) return '';
  return `A ${b.duration}-second ${b.platform || '(platform)'} UGC ad for ${b.product || '(product)'}, targeting ${b.audience || '(audience)'}. Goal: ${b.goal || '(goal)'}. Format: ${b.video_style || '(style)'}. Opens with "${b.hook || '(hook)'}" and closes on "${b.cta || '(CTA)'}". Dialogue in ${b.language || '(language)'}.`;
}

// Same meta-prompt shape as index.html's buildItemChatGptPrompt — this is
// the non-Flow production path: a filmed creator (or an AI creator without
// Flow open) gets a written, ChatGPT-composed shot list/direction instead of
// an image-generation prompt.
function buildChatGptMetaPrompt(item, fields) {
  const ic = itemConfigFor(item);
  const master = ic && ic.outputInstructions && ic.outputInstructions.length
    ? (ic.outputInstructions.find((o) => o.default) || ic.outputInstructions[0]).text
    : '';
  const contentDescription = compilePrompt(item, fields);
  const files = mustAttachFiles(item, fields);
  const fileNames = files.length ? files.map((f) => f.fileName).join(', ') : '(none attached yet)';
  const label = item.name || (itemConfigFor(item) || {}).label || item.item_key;
  return `I'm producing a "${label}" for a UGC-style product ad video. Use everything below — don't ask me for anything else, invent anything shown as a blank placeholder in parentheses like "(gender)" using good judgement for this brand:

Campaign brief: ${briefSummary()}

This item's own details:
${contentDescription || '(nothing filled in yet)'}

Reference files I already have: ${fileNames}

Base creative direction to follow:
${master || '(no template for this item type — just write a clean, concrete visual description)'}

Write me a clear, concrete shot list / shooting direction I can actually film from — no placeholders left unfilled. Output ONLY the direction text, nothing else before or after.`;
}

// ---------- rendering ----------
function updateStageBanner() {
  const bannerEl = document.getElementById('stageBanner');
  if (!bannerEl) return;
  if (!currentProjectId) { bannerEl.hidden = true; return; }
  bannerEl.hidden = false;
  document.getElementById('stageBannerProject').textContent = currentProjectName;
  document.getElementById('stageBannerStage').textContent = currentCompleted
    ? '✅ Completed'
    : `Stage ${currentStage} — ${STAGE_NAMES[currentStage] || ''}`;
}

function render() {
  updateStageBanner();
  if (!currentProjectId) return;
  if (currentCompleted) {
    itemListEl.innerHTML = `<p class="stage-empty-note">🎉 This project is completed — every stage is locked and paid. Nothing left to produce.</p>`;
    return;
  }
  if (currentStage === 1) {
    itemListEl.innerHTML = `<p class="stage-empty-note">Stage 1 (Brief) is filled in directly in StagePay itself — nothing to bridge to Flow yet. Once the brief is locked, reopen this panel.</p>`;
    return;
  }
  const items = currentItems.filter((i) => i.stage === currentStage);
  if (!items.length) {
    itemListEl.innerHTML = `<p class="stage-empty-note">No items yet in Stage ${currentStage} — ${escapeHtml(STAGE_NAMES[currentStage] || '')}.</p>`;
    return;
  }
  const isSingleItem = items.length === 1;
  itemListEl.innerHTML = items.map((item) => renderItemRow(item, isSingleItem)).join('');
  document.querySelectorAll('[data-toggle-item]').forEach((el) => el.addEventListener('click', () => {
    const id = el.getAttribute('data-toggle-item');
    expandedItems[id] = !expandedItems[id];
    render();
  }));
  // Only expanded items have any of this DOM to wire or thumbnails to fetch
  // in the first place — skipping collapsed ones avoids fetching every
  // other item's files just because the stage happened to render.
  items.forEach((item) => {
    if (!isSingleItem && !expandedItems[item.id]) return;
    loadThumbs(item);
    if (hasFlowPrompt(item)) loadMustAttach(item);
    wireItemCard(item);
  });
}

// ---------- downloads-folder gallery (File System Access API) ----------
// One folder, granted once, reused everywhere — see the file header for why
// showDirectoryPicker() is safe to rely on here despite the popup-specific
// bug report. The handle itself is stored in IndexedDB (structured-cloneable,
// unlike chrome.storage) so it survives the panel closing/reopening; only
// the underlying OS permission needs re-confirming per browser session.
const IDB_NAME = 'stagepay-bridge';
const IDB_STORE = 'handles';
const IDB_KEY = 'downloadsDir';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSaveDirHandle(handle) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbLoadDirHandle() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Runs once at panel startup — silent (queryPermission never prompts), so
// no user gesture is needed just to check whether a previously granted
// folder is still usable this session.
async function tryRestoreDownloadsFolder() {
  try {
    const handle = await idbLoadDirHandle();
    if (!handle) return;
    downloadsDirHandle = handle;
    const perm = await handle.queryPermission({ mode: 'read' });
    if (perm === 'granted') {
      folderPermissionState = 'granted';
      await scanDownloadsFolder();
    } else {
      folderPermissionState = 'needs-reconnect';
    }
  } catch (e) { /* nothing saved yet, or it's no longer valid — connect fresh */ }
}

// The actual one-time grant — requires a user gesture (the click that called
// this), which is exactly what showDirectoryPicker() needs. startIn opens
// the native dialog directly inside Downloads (the one further step it CAN
// take automatically — no API lets it silently pick the subfolder itself,
// that one confirmation click is a hard security boundary) so the user
// immediately sees the FLOW_DOWNLOADS_SUBFOLDER name from background.js
// (kept in sync manually — not shared code, just two small files) and picks
// it in one click instead of navigating from wherever the dialog last was.
async function connectDownloadsFolder() {
  try {
    const handle = await window.showDirectoryPicker({ startIn: 'downloads' });
    downloadsDirHandle = handle;
    folderPermissionState = 'granted';
    await idbSaveDirHandle(handle);
    await scanDownloadsFolder();
    render();
  } catch (e) { /* user cancelled the picker — leave state as it was */ }
}

// A previously granted handle whose OS permission lapsed (e.g. a new browser
// session) — re-affirms the SAME remembered folder rather than re-picking it.
async function reconnectDownloadsFolder() {
  if (!downloadsDirHandle) return connectDownloadsFolder();
  try {
    const perm = await downloadsDirHandle.requestPermission({ mode: 'read' });
    if (perm === 'granted') {
      folderPermissionState = 'granted';
      await scanDownloadsFolder();
    }
    render();
  } catch (e) { /* still not granted — stays in needs-reconnect state */ }
}

function revokeFolderThumbnails() {
  folderThumbnails.forEach((t) => URL.revokeObjectURL(t.url));
  folderThumbnails = [];
}

// Enumerates the granted folder's files (one level, no subfolders), filters
// to image/video, sorts newest-first by the file's own lastModified, keeps
// only the most recent FOLDER_GALLERY_LIMIT — a typical Downloads folder can
// have hundreds of unrelated entries, and nobody needs to scroll all of them
// to find what they just generated.
async function scanDownloadsFolder() {
  if (!downloadsDirHandle) return;
  revokeFolderThumbnails();
  const found = [];
  try {
    for await (const [name, handle] of downloadsDirHandle.entries()) {
      if (handle.kind !== 'file') continue;
      const file = await handle.getFile();
      if (!FOLDER_GALLERY_MIME_PREFIXES.some((p) => file.type.startsWith(p))) continue;
      found.push({ name, file, lastModified: file.lastModified });
    }
  } catch (e) { /* folder became inaccessible mid-scan — show whatever was found */ }
  found.sort((a, b) => b.lastModified - a.lastModified);
  folderThumbnails = found.slice(0, FOLDER_GALLERY_LIMIT).map((f) => ({
    name: f.name, file: f.file, url: URL.createObjectURL(f.file),
  }));
}

function renderFieldControl(def, value) {
  const path = def.key;
  if (def.type === 'pill') {
    return `<div class="setup-field"><label>${escapeHtml(def.label)}</label><div class="pill-row">
      ${def.options.map((o) => `<button type="button" class="${o === value ? 'selected' : ''}" data-field-pick="${path}" data-value="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('')}
    </div></div>`;
  }
  if (def.type === 'textarea') {
    // Full text, not truncated — .pill-row button now has white-space:
    // nowrap, so the pill just sizes to fit its own text on one line
    // (wrapping onto a new row via the row's own flex-wrap if it doesn't
    // fit) instead of needing to cut the label short to look right.
    const presetsHtml = def.presets && def.presets.length
      ? `<div class="pill-row presets" style="margin-bottom:4px">${def.presets.map((p) => `<button type="button" data-field-preset="${path}" data-value="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}</div>`
      : '';
    return `<div class="setup-field"><label>${escapeHtml(def.label)}</label>${presetsHtml}<textarea data-field-text="${path}">${escapeHtml(value || '')}</textarea></div>`;
  }
  return `<div class="setup-field"><label>${escapeHtml(def.label)}</label><input type="text" data-field-text="${path}" value="${escapeHtml(value ?? '')}"></div>`;
}

// Numbered steps, same convention the main web app already uses for
// Generate/Download/Paste/Upload — a flat stack of labeled sections gave no
// sense of "do this, then this." Steps that don't apply to this item type
// just don't get pushed, so the numbering is always dense (1, 2, 3 — never
// gaps) regardless of which ones are present.
function renderItemCard(item) {
  const ic = itemConfigFor(item);
  const schema = (ic && ic.content && ic.content.fieldsSchema) || [];
  const showPrompt = hasFlowPrompt(item);
  const draft = showPrompt ? draftFor(item) : null;
  const label = item.name || (ic && ic.label) || item.item_key;
  // Same precedence as `label` above (this WAS the bug — it used to skip
  // item.name and always fall back to the generic type label, so every
  // Scene's Movie clip showed "Setup Final Movie Clip" instead of "Setup
  // Scene 1 Movie Clip"). Reused so each step reads as "Generate Scene 1
  // Movie Clip" / "Choose & send Scene 1 Movie Clip" — this specific item,
  // not just its type. Matches the web app's own established phrasing (e.g.
  // its Scene Generate button already reads "Generate Scene Image Prompt",
  // not just "Generate").
  const noun = label;
  const steps = [];

  // Template mode: Setup drives the prompt, live — no separate Compile
  // click, the textarea just updates as fields change. Custom mode: Setup
  // is hidden (it has no effect here), the textarea is yours alone — paste
  // a ChatGPT-written template or write from scratch, nothing ever
  // auto-overwrites it. Persisted the same way Story/Scene/Movie already
  // remember Generate-vs-Upload, in fields._uiMode.
  const promptMode = showPrompt && draft.fields._uiMode === 'custom' ? 'custom' : 'template';
  if (showPrompt) {
    const modeToggleHtml = `<div class="item-mode-toggle">
      <button type="button" class="${promptMode === 'template' ? 'active' : ''}" data-prompt-mode-btn="template" data-item-id="${item.id}">🧩 Template</button>
      <button type="button" class="${promptMode === 'custom' ? 'active' : ''}" data-prompt-mode-btn="custom" data-item-id="${item.id}">✏️ Custom</button>
    </div>`;

    if (promptMode === 'template' && schema.length) {
      steps.push({
        title: `Setup ${noun}`,
        body: modeToggleHtml + schema.map((def) => renderFieldControl(def, draft.fields[def.key])).join(''),
      });
    }

    steps.push({
      title: `Generate ${noun}`,
      body: `
        ${(promptMode === 'custom' || !schema.length) ? modeToggleHtml : ''}
        <div class="must-attach-row" data-must-attach="${item.id}"></div>
        ${promptMode === 'custom'
          ? `<p class="prompt-mode-note">Your own prompt/template — nothing here ever auto-changes it.</p>`
          : (schema.length ? `<p class="prompt-mode-note">Read-only — mirrors Setup above exactly. Switch to Custom to write or paste your own.</p>` : '')}
        <textarea data-prompt-area="${item.id}" ${promptMode === 'template' ? 'readonly' : ''} placeholder="${promptMode === 'custom' ? 'Paste your custom prompt here...' : 'Edit Setup above to fill this in...'}">${escapeHtml((promptMode === 'custom' ? draft.fields._customPrompt : draft.prompt) || '')}</textarea>
        <div class="row">
          <button type="button" data-copy-prompt-btn="${item.id}">📋 Copy prompt</button>
          <button type="button" data-chatgpt-btn="${item.id}">🤖 Enhance this prompt with ChatGPT</button>
          <button type="button" class="primary" data-save-draft-btn="${item.id}">💾 Save</button>
        </div>`,
    });
  }

  const staged = stagingFiles[item.id] || [];
  const folderGalleryHtml = (() => {
    if (folderPermissionState === 'granted') {
      const galleryItems = folderThumbnails.length
        ? `<div class="folder-gallery-row">${folderThumbnails.map((t, i) => {
            const isSelected = staged.includes(t.file);
            const isVideo = t.file.type.startsWith('video');
            const media = isVideo ? `<video src="${t.url}" muted></video>` : `<img src="${t.url}">`;
            const videoBadge = isVideo ? `<span class="video-badge">▶</span>` : '';
            return `<div class="folder-gallery-wrap${isSelected ? ' selected' : ''}" data-folder-thumb="${item.id}" data-index="${i}" title="${escapeHtml(t.name)}">${media}${videoBadge}${isSelected ? `<span class="folder-gallery-tick">✓</span>` : ''}</div>`;
          }).join('')}</div>`
        : `<p class="folder-gallery-empty">No recent images/videos found in that folder yet — click 🔄 after downloading something.</p>`;
      return `<div class="folder-gallery-head"><strong>🔗 Connected: ${escapeHtml(downloadsDirHandle ? downloadsDirHandle.name : '')}</strong><button type="button" data-rescan-folder-btn>🔄 Rescan</button><button type="button" data-reconnect-folder-btn>Change folder</button></div>${galleryItems}<p class="folder-gallery-empty">Click a thumbnail to select/deselect it — ticked ones are what "Send" below will upload.</p>`;
    }
    if (folderPermissionState === 'needs-reconnect') {
      return `<div class="folder-gallery-head"><button type="button" data-reconnect-folder-btn>🔓 Reconnect "${escapeHtml(downloadsDirHandle ? downloadsDirHandle.name : 'downloads')}" folder</button></div>`;
    }
    return `<div class="folder-gallery-head"><button type="button" data-connect-folder-btn>🔗 Connect downloads folder</button><span>pick "${escapeHtml(FLOW_DOWNLOADS_SUBFOLDER_HINT)}" inside Downloads — Flow's files land there automatically</span></div>`;
  })();

  steps.push({
    title: `Choose & send ${noun}`,
    body: `
      ${!showPrompt ? `<p class="no-prompt-note">No Flow/ChatGPT prompt for this item type — just attach your file directly (this includes a Final Movie clip stitched/downloaded from Flow too).</p>` : ''}
      ${folderGalleryHtml}
      <div class="dropzone" data-dropzone="${item.id}">Or drag one or more files here, or click to choose manually</div>
      <input type="file" accept="${mediaAcceptFor(item.item_key)}" multiple style="display:none" data-file-input="${item.id}">
      <div class="staging-row" data-staging="${item.id}"></div>
      <p class="staging-note" data-staging-note="${item.id}" ${stagingNotes[item.id] ? '' : 'hidden'}>${escapeHtml(stagingNotes[item.id] || '')}</p>
      <div class="row" data-staging-actions="${item.id}" ${staged.length ? '' : 'hidden'}>
        <button type="button" class="primary" data-send-staged-btn="${item.id}">⬆ Send ${staged.length} file(s) to StagePay</button>
      </div>`,
  });

  const currentFiles = theVersion(item).media_files || [];
  steps.push({
    title: `${noun} Deliverable`,
    body: `
      <div class="thumb-row" data-thumbs="${item.id}"></div>
      ${currentFiles.length ? '' : `<p class="deliverable-empty">Nothing sent yet — pick and send a file above.</p>`}`,
  });

  return steps.map((s, i) => `<div class="section-label">${i + 1}. ${s.title}</div>${s.body}`).join('');
}

// A quick, no-fetch-required summary for a collapsed row — enough to see
// what's left to do across a whole stage without opening every item.
function itemStatusSummary(item) {
  const sent = (theVersion(item).media_files || []).length;
  const staged = (stagingFiles[item.id] || []).length;
  if (sent > 0) return `✅ ${sent} file(s)`;
  if (staged > 0) return `🟡 ${staged} staged, not sent`;
  return '— nothing yet';
}

// One item at a time, matching the main web app's own collapsed-by-default
// item cards (state.expandedItems) — a stage with several Characters/Props/
// Scenes was rendering every single one fully expanded at once, which is
// exactly the "visually overloading" problem the swimlane already solved
// this same way. A lone item in a stage (Story is always exactly one) skips
// the collapse chrome entirely — nothing to collapse when there's only one.
const expandedItems = {};
function renderItemRow(item, isSingleItem) {
  const ic = itemConfigFor(item);
  const label = item.name || (ic && ic.label) || item.item_key;
  if (isSingleItem) {
    return `<div class="item-card" data-item-id="${item.id}"><h3>${escapeHtml(label)}</h3>${renderItemCard(item)}</div>`;
  }
  const isExpanded = !!expandedItems[item.id];
  return `<div class="item-card" data-item-id="${item.id}">
    <div class="item-row-head" data-toggle-item="${item.id}">
      <strong>${escapeHtml(label)}</strong>
      <span class="item-row-status">${itemStatusSummary(item)}</span>
      <span class="item-row-chevron">${isExpanded ? '▾' : '▸'}</span>
    </div>
    ${isExpanded ? renderItemCard(item) : ''}
  </div>`;
}

// Loads the must-attach reference images (the INPUTS this item needs
// already attached before generating) — distinct from loadThumbs below,
// which shows this item's own already-uploaded OUTPUT. Same clipboard-copy
// mechanism, different source list.
async function loadMustAttach(item) {
  const row = document.querySelector(`[data-must-attach="${item.id}"]`);
  if (!row) return;
  const draft = draftFor(item);
  const files = mustAttachFiles(item, draft.fields);
  for (const f of files) {
    try {
      const mediaUrl = `${API_BASE}/api/media/${f.key}`;
      const r = await fetch(mediaUrl, { credentials: 'include' });
      if (!r.ok) continue;
      const blob = await r.blob();
      if (!blob.type.startsWith('image/')) continue;
      const wrap = document.createElement('div');
      wrap.className = 'must-attach-wrap';
      const img = document.createElement('img');
      img.src = mediaUrl;
      img.title = f.fileName;
      const copyBtn = document.createElement('button');
      copyBtn.className = 'must-attach-copy-btn';
      copyBtn.textContent = '📋';
      copyBtn.title = `Copy "${f.fileName}" — then paste (Ctrl/Cmd+V) into Flow`;
      copyBtn.addEventListener('click', async () => {
        try {
          const pngBlob = blob.type === 'image/png' ? blob : await blobToPngBlob(blob);
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
          setLastCopied({ kind: 'image', label: f.fileName, preview: mediaUrl });
          copyBtn.textContent = '✓';
        } catch (e) {
          copyBtn.textContent = '✗';
        }
        setTimeout(() => { copyBtn.textContent = '📋'; }, 1200);
      });
      wrap.appendChild(img);
      wrap.appendChild(copyBtn);
      row.appendChild(wrap);
    } catch (e) { /* skip a file that failed to load */ }
  }
}

// Every uploaded file gets a wrap + remove button regardless of type — a
// video/audio deliverable previously had no representation at all here (the
// old code just skipped anything non-image), which meant no way to delete
// one via the extension. Images and videos both get a fetched, real
// preview (only images also get a copy button); audio/other files fall
// back to a generic icon but are just as removable either way.
function loadThumbs(item) {
  const row = document.querySelector(`[data-thumbs="${item.id}"]`);
  if (!row) return;
  const files = theVersion(item).media_files || [];
  files.forEach((f, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb-wrap';
    wrap.title = f.fileName;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'thumb-remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = `Remove "${f.fileName}" from this item`;
    removeBtn.addEventListener('click', () => removeMediaFile(item.id, i));
    wrap.appendChild(removeBtn);

    if (f.kind === 'image') {
      loadImageThumb(f, wrap);
    } else if (f.kind === 'video') {
      // Icon first (synchronous, always visible), then try to upgrade to a
      // real video frame once fetched — never leaves the slot blank if the
      // fetch fails, just stays on the icon.
      const icon = document.createElement('span');
      icon.className = 'thumb-generic-icon';
      icon.textContent = '🎬';
      wrap.appendChild(icon);
      loadVideoThumb(f, wrap, icon);
    } else {
      const icon = document.createElement('span');
      icon.className = 'thumb-generic-icon';
      icon.textContent = f.kind === 'audio' ? '🔊' : '📄';
      wrap.appendChild(icon);
    }
    row.appendChild(wrap);
  });
}

// Same fetch-then-render shape as loadImageThumb, but for video — this is
// the one that was missing entirely; videos previously never got past the
// generic 🎬 icon. Adds a small badge too, so a video thumbnail (whose
// first frame alone can look identical to a photo) is unambiguous at a
// glance, not just a different tag under the hood.
async function loadVideoThumb(f, wrap, iconEl) {
  try {
    const mediaUrl = `${API_BASE}/api/media/${f.key}`;
    const r = await fetch(mediaUrl, { credentials: 'include' });
    if (!r.ok) return;
    const blob = await r.blob();
    if (!blob.type.startsWith('video/')) return;
    const objectUrl = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.src = objectUrl;
    video.muted = true;
    video.title = f.fileName;
    const badge = document.createElement('span');
    badge.className = 'video-badge';
    badge.textContent = '▶';
    iconEl.replaceWith(video);
    wrap.appendChild(badge);
  } catch (e) { /* leave the generic 🎬 icon in place */ }
}

async function loadImageThumb(f, wrap) {
  try {
    const mediaUrl = `${API_BASE}/api/media/${f.key}`;
    const r = await fetch(mediaUrl, { credentials: 'include' });
    if (!r.ok) return;
    const blob = await r.blob();
    if (!blob.type.startsWith('image/')) return;

    // Two attempts at native drag-out (blob URL + items.add(file), then a
    // plain https <img> with zero custom code) both had Flow receive only
    // text (text/plain, then text/uri-list/text/html) — never real file
    // data. Both failures share one thing: dragging OUT of an extension
    // side panel specifically, which strongly points at a platform-level
    // restriction on that surface rather than anything fixable in our drag
    // code. Clipboard copy sidesteps the whole boundary — it's a real OS
    // clipboard write, not a synthetic drag, so there's no cross-context
    // file-data question at all. This is now the primary, reliable path;
    // the image stays draggable too in case drag ever starts working.
    const img = document.createElement('img');
    img.src = mediaUrl;
    img.draggable = true;
    img.title = f.fileName;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'thumb-copy-btn';
    copyBtn.textContent = '📋';
    copyBtn.title = 'Copy image — then paste (Ctrl/Cmd+V) into Flow';
    copyBtn.addEventListener('click', async () => {
      try {
        // Chrome's clipboard API has historically only reliably accepted
        // image/png via ClipboardItem — writing image/jpeg (or others)
        // directly often throws outright. Convert to PNG first so this
        // works regardless of the original upload's format.
        const pngBlob = blob.type === 'image/png' ? blob : await blobToPngBlob(blob);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        setLastCopied({ kind: 'image', label: f.fileName, preview: mediaUrl });
        copyBtn.textContent = '✓';
      } catch (e) {
        console.error('[StagePay Bridge] clipboard copy failed', e);
        copyBtn.textContent = '✗';
      }
      setTimeout(() => { copyBtn.textContent = '📋'; }, 1200);
    });
    wrap.appendChild(img);
    wrap.appendChild(copyBtn);
  } catch (e) { /* leave the generic icon state — remove button still works */ }
}

// Same shape as the web app's own remove-media handling: PATCH the item's
// version with this one file filtered out of media_files. Only removes the
// reference, same as the web app — the underlying R2 object isn't deleted.
async function removeMediaFile(itemId, index) {
  const item = currentItems.find((i) => i.id === itemId);
  const mediaFiles = (theVersion(item).media_files || []).filter((_, i) => i !== index);
  await fetch(`${API_BASE}/api/items/${itemId}/version`, {
    method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaFiles }),
  });
  theVersion(item).media_files = mediaFiles;
  render();
}

function blobToPngBlob(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob((pngBlob) => {
        URL.revokeObjectURL(objectUrl);
        if (pngBlob) resolve(pngBlob); else reject(new Error('canvas_to_blob_failed'));
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('image_decode_failed')); };
    img.src = objectUrl;
  });
}

function wireItemCard(item) {
  const showPrompt = hasFlowPrompt(item);

  if (showPrompt) {
    const draft = draftFor(item);
    const promptMode = draft.fields._uiMode === 'custom' ? 'custom' : 'template';
    const promptArea = document.querySelector(`[data-prompt-area="${item.id}"]`);
    // Template mode only — recompute and push straight into the textarea, no
    // full render() (matches the same light-touch pattern pills/presets
    // already use elsewhere). Custom mode never runs this: Setup isn't even
    // shown there, and nothing should touch a hand-pasted prompt.
    const recompileIfTemplate = () => {
      if (promptMode !== 'template') return;
      const composed = composeFinalPrompt(item, compilePrompt(item, draft.fields));
      draft.prompt = composed;
      if (promptArea) promptArea.value = composed;
    };
    // Covers the case recompileIfTemplate's other call sites can't: an item
    // with NO Setup fields at all (Story, always) never fires a single
    // field-change event, so nothing would ever trigger that first compile —
    // the box would just stay blank forever. Runs once per card render, but
    // only actually does anything while the prompt is still empty, so it
    // never overwrites a real compile or a hand-typed edit on a later render.
    if (promptMode === 'template' && !draft.prompt) recompileIfTemplate();

    document.querySelectorAll(`[data-item-id="${item.id}"] [data-prompt-mode-btn]`).forEach((btn) => btn.addEventListener('click', () => {
      draft.fields._uiMode = btn.getAttribute('data-prompt-mode-btn');
      render(); // Setup showing/hiding and the textarea's placeholder both change — a real structural change, not just a value update
    }));

    // Neither of these touches anything outside its own field/the prompt —
    // no reason to rebuild the whole panel (the gallery, other items, etc.)
    // just because one Setup pill/preset was clicked.
    document.querySelectorAll(`[data-item-id="${item.id}"] [data-field-pick]`).forEach((btn) => btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-field-pick');
      draft.fields[key] = btn.getAttribute('data-value');
      const row = btn.closest('.pill-row');
      if (row) row.querySelectorAll('[data-field-pick]').forEach((b) => b.classList.toggle('selected', b === btn));
      recompileIfTemplate();
    }));
    // Replaces, not appends — these presets are each a complete, mutually
    // exclusive direction (e.g. Movie's "Quick zoom in, then hold steady"
    // vs. "Slow pull back to reveal the scene"), not composable fragments.
    // Appending two together produces a contradiction, not a richer one.
    document.querySelectorAll(`[data-item-id="${item.id}"] [data-field-preset]`).forEach((btn) => btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-field-preset');
      const preset = btn.getAttribute('data-value');
      draft.fields[key] = preset;
      const textarea = document.querySelector(`[data-item-id="${item.id}"] [data-field-text="${key}"]`);
      if (textarea) textarea.value = draft.fields[key];
      recompileIfTemplate();
    }));
    // 'input' (not 'change') so some OTHER action that still does a full
    // render() (e.g. clicking a gallery thumbnail in Step 3) never discards
    // an in-progress, not-yet-blurred edit in a text field.
    document.querySelectorAll(`[data-item-id="${item.id}"] [data-field-text]`).forEach((el) => el.addEventListener('input', () => {
      draft.fields[el.getAttribute('data-field-text')] = el.value;
      recompileIfTemplate();
    }));
    // Template and Custom keep entirely separate text — draft.prompt for the
    // compiled/readonly Template view, fields._customPrompt for Custom —
    // so switching tabs never mixes one mode's text into the other's box,
    // and each survives independently across a tab switch or a reload.
    if (promptArea) promptArea.addEventListener('input', () => {
      if (promptMode === 'custom') draft.fields._customPrompt = promptArea.value;
      else draft.prompt = promptArea.value; // readonly in this mode, but harmless if ever reached
    });
    // Copy, ChatGPT, and Send are each a moment where you're about to step
    // away from the panel to go use this somewhere else — the exact moments
    // unsaved Setup/prompt work was previously at risk of being silently
    // lost if the panel closed before you got back to click Save. All three
    // now persist too, alongside Save staying available as its own,
    // earlier, optional checkpoint (e.g. right after typing something into
    // Custom, before you've even copied it anywhere).
    const copyPromptBtn = document.querySelector(`[data-copy-prompt-btn="${item.id}"]`);
    if (copyPromptBtn) copyPromptBtn.addEventListener('click', () => {
      const text = currentPromptFor(item);
      navigator.clipboard.writeText(text).then(() => {
        setLastCopied({ kind: 'prompt', label: item.name || item.item_key, preview: text });
        copyPromptBtn.textContent = '✓ Copied';
        setTimeout(() => { copyPromptBtn.textContent = '📋 Copy prompt'; }, 1200);
      });
      saveItemDraft(item);
    });

    const chatgptBtn = document.querySelector(`[data-chatgpt-btn="${item.id}"]`);
    if (chatgptBtn) chatgptBtn.addEventListener('click', () => {
      const metaPrompt = buildChatGptMetaPrompt(item, draft.fields);
      navigator.clipboard.writeText(metaPrompt).catch(() => {});
      chrome.tabs.create({ url: `https://chatgpt.com/?q=${encodeURIComponent(metaPrompt)}` });
      saveItemDraft(item);
    });

    const saveBtn = document.querySelector(`[data-save-draft-btn="${item.id}"]`);
    if (saveBtn) saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      await saveItemDraft(item);
      saveBtn.disabled = false; saveBtn.textContent = '✓ Saved';
      setTimeout(() => { saveBtn.textContent = '💾 Save'; }, 1200);
    });
  }

  document.querySelectorAll(`[data-item-id="${item.id}"] [data-connect-folder-btn]`).forEach((btn) => btn.addEventListener('click', connectDownloadsFolder));
  document.querySelectorAll(`[data-item-id="${item.id}"] [data-reconnect-folder-btn]`).forEach((btn) => btn.addEventListener('click', reconnectDownloadsFolder));
  document.querySelectorAll(`[data-item-id="${item.id}"] [data-rescan-folder-btn]`).forEach((btn) => btn.addEventListener('click', async () => { await scanDownloadsFolder(); render(); }));
  document.querySelectorAll(`[data-item-id="${item.id}"] [data-folder-thumb]`).forEach((el) => el.addEventListener('click', () => {
    const idx = Number(el.getAttribute('data-index'));
    const thumb = folderThumbnails[idx];
    if (!thumb) return;
    const staged = stagingFiles[item.id] || [];
    if (staged.includes(thumb.file)) {
      stagingFiles[item.id] = staged.filter((f) => f !== thumb.file);
      render();
    } else {
      addToStaging(item.id, [thumb.file]);
    }
  }));

  const dz = document.querySelector(`[data-dropzone="${item.id}"]`);
  const fileInput = document.querySelector(`[data-file-input="${item.id}"]`);
  if (dz && fileInput) {
    dz.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      addToStaging(item.id, Array.from(fileInput.files));
      fileInput.value = '';
    });
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      addToStaging(item.id, Array.from(e.dataTransfer.files));
    });
  }

  renderStaging(item); // wires its own remove buttons — nothing to wire again here
  const sendBtn = document.querySelector(`[data-send-staged-btn="${item.id}"]`);
  if (sendBtn) sendBtn.addEventListener('click', () => sendStagedFiles(item.id));
}

// Picked/dropped files are staged locally first (not uploaded immediately)
// so several Flow variants can be gathered — via one multi-select dialog or
// several drops — reviewed as real thumbnails (genuine File bytes, unlike
// the "Recent downloads" list above which is metadata-only), and culled down
// to just the ones actually worth sending, before anything reaches StagePay.
//
// Capped at maxFilesFor(item) total (already-uploaded + staged) — mirrors
// index.html's own per-type limit (1 file for almost everything, 2 for
// Story) so the extension can't push an item past what the web app's own
// UI would ever allow directly.
function addToStaging(itemId, files) {
  if (!files.length) return;
  const item = currentItems.find((i) => i.id === itemId);
  if (!stagingFiles[itemId]) stagingFiles[itemId] = [];
  const notes = [];

  // The accept attribute only filters what the picker dialog shows by
  // default — it does nothing at all for drag-and-drop or a folder-gallery
  // click, so this is the one real gate every path actually goes through.
  const requiredKind = requiredKindFor(item.item_key);
  const wrongKind = files.filter((f) => fileKindOf(f) !== requiredKind);
  const kindOk = files.filter((f) => fileKindOf(f) === requiredKind);
  if (wrongKind.length) {
    notes.push(`${wrongKind.map((f) => `"${f.name}"`).join(', ')} — this item only accepts ${requiredKind} files.`);
  }

  const maxMb = maxUploadMb(item.item_key);
  const oversized = kindOk.filter((f) => !checkFileSize(f, maxMb));
  const okFiles = kindOk.filter((f) => checkFileSize(f, maxMb));
  if (oversized.length) {
    notes.push(oversized.map((f) => `"${f.name}" is ${(f.size / (1024 * 1024)).toFixed(1)}MB`).join(', ') + ` — max allowed is ${maxMb}MB.`);
  }

  const max = maxFilesFor(item);
  const existingCount = (theVersion(item).media_files || []).length;
  const alreadyStaged = stagingFiles[itemId].length;
  const room = Math.max(0, max - existingCount - alreadyStaged);

  if (room <= 0) {
    if (okFiles.length) notes.push(`This item already has its max of ${max} file(s) — remove one first (from here or StagePay) before adding another.`);
  } else if (okFiles.length > room) {
    stagingFiles[itemId].push(...okFiles.slice(0, room));
    notes.push(`Only added ${room} of ${okFiles.length} — max ${max} file(s) allowed for this item.`);
  } else {
    stagingFiles[itemId].push(...okFiles);
  }
  stagingNotes[itemId] = notes.length ? notes.join(' ') : null;
  render(); // full re-render — not just the staging row — so a gallery thumbnail's tick mark (and this note) stay in sync with actual state, not a one-off DOM mutation render() would immediately overwrite
}

function updateStagingActions(itemId) {
  const actionsEl = document.querySelector(`[data-staging-actions="${itemId}"]`);
  const btn = document.querySelector(`[data-send-staged-btn="${itemId}"]`);
  const count = (stagingFiles[itemId] || []).length;
  if (actionsEl) actionsEl.hidden = count === 0;
  if (btn) btn.textContent = `⬆ Send ${count} file(s) to StagePay`;
}

// Blob URLs created here are intentionally never revoked — a bounded,
// short-lived leak (cleared when the panel itself closes/reloads) rather
// than tracking per-file URL lifetimes across re-renders for a handful of
// staged thumbnails at a time.
function renderStaging(item) {
  const row = document.querySelector(`[data-staging="${item.id}"]`);
  if (!row) return;
  const files = stagingFiles[item.id] || [];
  row.innerHTML = files.map((file, i) => {
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video');
    const media = isVideo ? `<video src="${url}" muted></video>` : `<img src="${url}">`;
    const videoBadge = isVideo ? `<span class="video-badge">▶</span>` : '';
    return `<div class="staging-wrap" title="${escapeHtml(file.name)}">${media}${videoBadge}<button type="button" class="staging-remove-btn" data-staging-remove="${item.id}" data-index="${i}">×</button></div>`;
  }).join('');
  document.querySelectorAll(`[data-staging="${item.id}"] [data-staging-remove]`).forEach((btn) => btn.addEventListener('click', () => {
    const idx = Number(btn.getAttribute('data-index'));
    stagingFiles[item.id].splice(idx, 1);
    stagingNotes[item.id] = null; // removing a staged file can only free up room, never re-trigger the cap
    render(); // keeps a gallery thumbnail's tick in sync if the removed file came from there
  }));
}

// Mirrors StagePay's own upload flow: POST each file's bytes to /api/media,
// then one PATCH appending every resulting {key, fileName, kind} to the
// item's media_files together — a single PATCH for the whole batch rather
// than one per file, so a multi-file send can't race itself re-reading a
// media_files list another in-flight upload just changed.
async function sendStagedFiles(itemId) {
  const files = stagingFiles[itemId] || [];
  if (!files.length) return;
  const sendBtn = document.querySelector(`[data-send-staged-btn="${itemId}"]`);
  const item = currentItems.find((i) => i.id === itemId);
  const existingCount = (theVersion(item).media_files || []).length;
  const uploaded = [];
  for (let i = 0; i < files.length; i++) {
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = `Uploading ${i + 1}/${files.length}…`; }
    const file = files[i];
    try {
      const cleanName = cleanUploadFileName(item, file.name, existingCount + uploaded.length);
      const uploadRes = await fetch(
        `${API_BASE}/api/media?projectId=${encodeURIComponent(currentProjectId)}&fileName=${encodeURIComponent(cleanName)}`,
        { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }
      );
      const result = await uploadRes.json();
      if (!result.key) throw new Error('upload_failed');
      const kind = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'image';
      uploaded.push({ key: result.key, fileName: result.fileName || cleanName, kind });
    } catch (e) {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = `Upload failed on file ${i + 1} — try again`; }
      stagingFiles[itemId] = files.slice(i); // keep whatever didn't make it, so nothing's silently lost
      renderStaging(item);
      updateStagingActions(itemId);
      return;
    }
  }
  const mediaFiles = [...(theVersion(item).media_files || []), ...uploaded];
  // Previously this PATCH only ever included mediaFiles — Setup/prompt work
  // was never persisted just by sending a file, only by separately
  // remembering to click Save. One combined PATCH now, not two round trips.
  const patchBody = { mediaFiles };
  if (hasFlowPrompt(item)) {
    const draft = draftFor(item);
    patchBody.fields = draft.fields;
    patchBody.prompt = currentPromptFor(item);
  }
  await fetch(`${API_BASE}/api/items/${itemId}/version`, {
    method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patchBody),
  });
  theVersion(item).media_files = mediaFiles;
  if (patchBody.fields) { theVersion(item).fields = patchBody.fields; theVersion(item).prompt = patchBody.prompt; }
  stagingFiles[itemId] = [];
  render();
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Real-time rescan trigger — background.js sends this the instant a
// redirected Flow download finishes (via chrome.downloads.onChanged), so
// the gallery updates itself with no manual "Rescan" click needed.
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'stagepay-bridge-download-ready' && folderPermissionState === 'granted') {
    scanDownloadsFolder().then(render);
  }
});

init();

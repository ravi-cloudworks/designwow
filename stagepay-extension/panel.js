// StagePay Director — side panel logic.
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
const STAGE_NAMES = { 1: 'Creative Brief', 2: 'Story & Script', 3: 'Creative Direction', 4: 'Production Blueprint', 5: 'Final Ad Delivery' };

let currentProjectId = null;
let currentProjectName = '';
let currentBrief = null;
let currentItems = [];
let currentStage = null; // from GET /api/projects (list) — "the next thing to actually do", not a manually-picked tab
let currentCompleted = false;
// The extension is Director-exclusive — set by checkAccountAccess() before
// any project is even detected; renderNoDirectorAccessWall() replaces the
// whole panel instead of this reaching any item-rendering code at all when
// false, so nothing downstream of that point needs its own separate check.
let hasDirectorAccess = false;
let currentUserEmail = ''; // set by checkAccountAccess() — shown on the no-Director wall so it's clear which account is being checked
let directorAccessUntilDate = null; // raw 'YYYY-MM-DD' from GET /auth/me, or null for no expiry — only meaningful once already 'ok' (an already-past date means hasDirectorAccess is false and the wall shows instead, not this)
const EXPIRY_WARNING_DAYS = 7; // proactive nudge window — matches the same threshold used on the web app's own banner
const stageConfigCache = {}; // { [stage]: parsed config JSON from GET /api/config/:stage }
const itemDrafts = {}; // { [itemId]: { fields, prompt } } — in-memory only until "Save"
const stagingFiles = {}; // { [itemId]: File[] } — picked/dropped but not yet sent to StagePay
const stagingNotes = {}; // { [itemId]: string | null } — must be real state, not an imperative DOM mutation: addToStaging calls render() right after setting it, which rebuilds the whole card from scratch and would otherwise wipe out a one-off element mutation immediately
let lastCopied = null; // { kind: 'prompt' | 'image', label, preview, copiedAt } — the single most recent copy, not a history

// One granted folder, shared across every item — the browser has no idea
// which StagePay item a downloaded file is "for," so there's exactly one
// gallery, and the user clicks whichever thumbnail belongs where.
let downloadsDirHandle = null;
let folderPermissionState = 'none'; // 'none' | 'granted' | 'needs-reconnect' | 'missing'
let folderThumbnails = []; // [{ name, file, url }] — most recent first
// Set when the user picks a folder in showDirectoryPicker() that isn't
// named FLOW_DOWNLOADS_SUBFOLDER_HINT — the name is mandatory (see
// connectDownloadsFolder), since background.js's redirect target is
// hardcoded and a differently-named folder would silently stop receiving
// Flow's downloads.
let folderNameMismatch = null;
// Mandatory "which item is this file for?" prompt, one at a time — fired
// the instant a redirected Flow download completes (see the
// stagepay-director-download-ready listener below). Queued rather than
// stacked so several downloads finishing close together don't pile up
// several overlapping modals at once. No skip option, by design: an
// unlabeled clip sitting in the folder with Flow's own generic name is
// exactly the "which one was Scene 3 again?" confusion this whole feature
// exists to prevent.
const pendingRenameFiles = []; // { fileName, projectFolder } awaiting a choice
let renamingFile = null; // the { fileName, projectFolder } currently shown in the modal, or null
const FOLDER_GALLERY_LIMIT = 16;
const FOLDER_GALLERY_MIME_PREFIXES = ['image/', 'video/'];
// Must match FLOW_DOWNLOADS_SUBFOLDER in background.js — not shared code
// (separate execution contexts), just kept in sync by hand. Mandatory, not
// just a hint: background.js only ever redirects Flow's downloads into
// this exact name, so any other folder name silently breaks auto-detection.
const FLOW_DOWNLOADS_SUBFOLDER_HINT = 'StagePayDirector';

const statusEl = document.getElementById('projectStatus');
const itemListEl = document.getElementById('itemList');
const lastCopiedSectionEl = document.getElementById('lastCopiedSection');
const landingIntroEl = document.getElementById('landingIntro');
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

// A shimmering placeholder shown the instant the panel opens (or starts a
// real reload) instead of an empty list that then snaps to fully-populated
// once the fetches resolve — that abrupt empty-then-everything jump is the
// "flicker." Shown immediately, synchronously, before any awaiting starts.
function renderSkeleton() {
  itemListEl.innerHTML = `
    <div class="skeleton-card">
      <div class="skeleton-line" style="width:40%"></div>
      <div class="skeleton-line" style="width:75%"></div>
      <div class="skeleton-line" style="width:55%"></div>
    </div>
    <div class="skeleton-card">
      <div class="skeleton-line" style="width:35%"></div>
      <div class="skeleton-line" style="width:60%"></div>
    </div>`;
}

async function init() {
  renderSkeleton();
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

// Sets the small #projectStatus line AND, for anything other than 'ok',
// forces a persistent blocking modal too — these 4 states (no project tab
// found, multiple conflicting projects open, not logged in, project load
// failed) are standing conditions, not one-off events, so unlike the
// dismissible openUploadErrorModal() this has no close button: it mirrors
// renderFolderConnectModal()'s same forced pattern, and clears itself the
// next time setStatus('Connected', 'ok') runs, not on user action.
function setStatus(message, kind, title) {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
  // Tells background.js's Flow-download redirect which project's subfolder
  // new downloads should land in — plain runtime messaging, not
  // chrome.storage, so no new "storage" permission (and no Web Store
  // re-review) is needed; background.js just keeps it in memory. Sent as
  // null for every non-'ok' state (logged out, multiple projects open, no
  // project detected, load failed) so a download that happens while no
  // project is confidently known can't get misfiled into a stale project's
  // folder — it just falls back to the flat top-level folder instead.
  chrome.runtime.sendMessage({ type: 'stagepay-director-set-project', name: kind === 'ok' ? currentProjectName : null, id: kind === 'ok' ? currentProjectId : null }).catch(() => {});
  const root = document.getElementById('statusModalRoot');
  if (!root) return;
  if (kind === 'ok') { root.innerHTML = ''; return; }
  // This overlay sits on top of the header too, covering the panel's own
  // refresh button — without its own recheck button the only way to clear
  // a resolved condition (e.g. closed the other project's tab) would be
  // leaving and refocusing the window, since that's what actually re-runs
  // refreshFromActiveTab(). Confirmed live: it doesn't auto-dismiss on its
  // own otherwise.
  root.innerHTML = `<div class="status-modal-overlay">
    <div class="status-modal-card status-modal-${kind}">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <button type="button" id="statusModalRecheckBtn">🔄 Check again</button>
    </div>
  </div>`;
  const btn = document.getElementById('statusModalRecheckBtn');
  if (btn) btn.addEventListener('click', () => refreshFromActiveTab(true));
}

// Extension = Director exclusively — there is no "StagePay-only" mode of
// this panel at all. Checked FIRST, before even looking at which tab/project
// is open, so a StagePay-only (or expired/suspended) account never triggers
// a single /api/projects or /api/projects/:id call — there's nothing they're
// entitled to see, so there's nothing worth fetching. Returns:
//   'not-logged-in' — no session at all (or the request itself failed)
//   'suspended'     — a real session, but the account is suspended (a total
//                     kill switch everywhere else too — see stagepay-api's
//                     index.ts global middleware — so it's treated the same
//                     way here rather than showing the upgrade wall)
//   'no-director'   — logged in, not suspended, but the Director addon
//                     isn't active (never purchased, or its own expiry date
//                     has passed)
//   'ok'            — proceed with the normal project-detection flow below
async function checkAccountAccess() {
  // Reset up front, not just on the success path — a stale value from a
  // PREVIOUS 'ok' check must never survive into a not-logged-in/suspended
  // result just because an early return skipped reassigning it.
  hasDirectorAccess = false;
  directorAccessUntilDate = null;
  let meRes;
  try {
    meRes = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
  } catch (e) {
    return 'not-logged-in'; // network failure — never assume access when unsure
  }
  if (!meRes.ok) return 'not-logged-in';
  const data = await meRes.json().catch(() => null);
  if (!data || !data.user) return 'not-logged-in';
  currentUserEmail = data.user.email || '';
  if (data.user.suspended) return 'suspended';
  hasDirectorAccess = !!data.user.hasDirectorAccess;
  directorAccessUntilDate = data.user.director_access_until || null;
  return hasDirectorAccess ? 'ok' : 'no-director';
}

// Proactive, non-blocking nudge above the item list — only shown once
// directorAccessUntilDate is within EXPIRY_WARNING_DAYS (an already-past
// date never reaches here at all: hasDirectorAccess would already be false,
// landing on the full 'no-director' wall instead of this softer banner).
// Hidden whenever there's nothing to warn about, including every non-'ok'
// access outcome — checkAccountAccess() resets directorAccessUntilDate to
// null on those, so this naturally clears itself without a separate check.
function updateExpiryBanner() {
  // Always-visible info line right under the "Connected to ..." status, but
  // ONLY when access is actually 'ok' — this runs unconditionally from
  // refreshFromActiveTab() for every outcome (not-logged-in, suspended,
  // no-director too), and hasDirectorAccess is the one flag that's only
  // ever true for 'ok'. Without this guard, a not-logged-in or suspended
  // session would incorrectly show "no expiry set" right under a status
  // line saying the opposite.
  const infoEl = document.getElementById('directorExpiryInfo');
  if (infoEl) {
    if (!hasDirectorAccess) {
      infoEl.hidden = true;
    } else if (directorAccessUntilDate) {
      const formatted = new Date(`${directorAccessUntilDate}T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      infoEl.textContent = `Director access until ${formatted}`;
      infoEl.hidden = false;
    } else {
      infoEl.textContent = 'Director access: no expiry set';
      infoEl.hidden = false;
    }
  }

  const el = document.getElementById('expiryBanner');
  if (!el) return;
  if (!directorAccessUntilDate) { el.hidden = true; return; }
  const daysLeft = Math.ceil((new Date(`${directorAccessUntilDate}T00:00:00`) - new Date()) / 86400000);
  if (daysLeft > EXPIRY_WARNING_DAYS) { el.hidden = true; return; }
  el.hidden = false;
  const whenText = daysLeft <= 0 ? 'today' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  el.innerHTML = `⏳ Director access expires ${whenText} — <a href="${API_BASE}/add-ons/director" target="_blank" rel="noopener">renew</a>`;
}

async function refreshFromActiveTab(force) {
  const access = await checkAccountAccess();
  updateExpiryBanner();
  if (access === 'not-logged-in') {
    setStatus('Not logged in — log into StagePay in a normal tab first, then reopen this panel.', 'error', '🔒 Not logged in');
    landingIntroEl.hidden = false;
    currentProjectId = null;
    itemListEl.innerHTML = '';
    updateStageBanner();
    return;
  }
  if (access === 'suspended') {
    setStatus('Your StagePay account has been suspended. Contact support if you believe this is a mistake.', 'error', '🚫 Account suspended');
    landingIntroEl.hidden = true;
    currentProjectId = null;
    itemListEl.innerHTML = '';
    updateStageBanner();
    return;
  }
  if (access === 'no-director') {
    // Bypasses setStatus() deliberately — that also pops its own persistent
    // "no dismiss" modal, which would sit redundantly on top of the wall
    // below. Directly replaces panel.html's static placeholder text
    // ("Looking for an open StagePay tab…"), which otherwise never gets
    // touched at all on this path — confirmed live, it was left showing
    // above the wall until this.
    statusEl.textContent = 'Director not active';
    statusEl.className = 'status';
    landingIntroEl.hidden = true;
    currentProjectId = null;
    currentItems = [];
    updateStageBanner();
    renderNoDirectorAccessWall();
    return;
  }

  const detected = await detectOpenProjectId();
  if (detected && detected.conflict) {
    await showProjectConflictWarning(detected.ids);
    return;
  }
  const projectId = detected;
  if (!projectId) {
    setStatus('No StagePay project tab found — open a project at stagepay.pages.dev, then reopen this panel.', 'error', '🔍 No project detected');
    landingIntroEl.hidden = false;
    currentProjectId = null;
    itemListEl.innerHTML = '';
    updateStageBanner();
    return;
  }
  if (projectId === currentProjectId && !force) return; // already showing this one
  currentProjectId = projectId;
  renderSkeleton(); // a real reload is about to happen (new project, or a forced refetch) — shimmer instead of a jump
  await loadProject();
  render();
}

// The only UI a StagePay-only (or Director-expired) account ever sees in
// this panel — replaces the whole item list, no upload/staging affordance
// left reachable, matching the "buy Director or the extension shows
// nothing" decision. A "Check again" button covers the case where they
// upgrade in another tab while this panel is still open, same pattern as
// setStatus()'s persistent modal.
function renderNoDirectorAccessWall() {
  itemListEl.innerHTML = `
    <div class="no-director-wall">
      <p class="no-director-wall-icon">🔒</p>
      <h2>Director access needed</h2>
      <p class="no-director-wall-body">${currentUserEmail ? `<strong>${escapeHtml(currentUserEmail)}</strong> doesn't` : 'This account doesn\'t'} have Director active — either it was never purchased, or it has expired.</p>
      <p class="no-director-wall-body">Director unlocks compiled Flow-ready prompts, auto-attached character/scene references, and structured production tools inside Google Flow.</p>
      <a class="no-director-wall-cta" href="${API_BASE}/add-ons/director" target="_blank" rel="noopener">Learn more &amp; upgrade →</a>
      <button type="button" id="noDirectorRecheckBtn">I've paid — check again</button>
    </div>`;
  const btn = document.getElementById('noDirectorRecheckBtn');
  if (btn) btn.addEventListener('click', () => refreshFromActiveTab(true));
}

// Fires when two (or more) DIFFERENT projects are open across StagePay tabs
// at once and this window's own active tab isn't StagePay itself, so there's
// no unambiguous signal for which one this panel should show. Names the
// conflicting projects (one extra /api/projects fetch, only paid in this
// rare case) so the user knows exactly which tab to close, rather than a
// generic "multiple projects" message.
async function showProjectConflictWarning(ids) {
  currentProjectId = null;
  currentItems = [];
  itemListEl.innerHTML = '';
  landingIntroEl.hidden = false;
  updateStageBanner();
  let names = ids;
  try {
    const res = await fetch(`${API_BASE}/api/projects`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      const byId = {};
      (data.projects || []).forEach((p) => { byId[p.id] = p.name; });
      names = ids.map((id) => byId[id] || id);
    }
  } catch (e) { /* fine — falls back to raw ids below */ }
  setStatus(`Multiple StagePay projects are open at once (${names.join(', ')}) — close all but one so Director knows which project to show.`, 'warn', '⚠️ Multiple projects open');
}

// The web app already puts the open project's id in the URL as ?p=<id>
// (added for its own refresh-persistence) — reading that is simpler and
// more robust than trying to scrape the page for it. Always scans across
// ALL windows, not just this one — a single login only ever has one project
// open in the common case (StagePay in one window/monitor, Flow in
// another), so restricting to currentWindow would break that entirely
// legitimate setup by finding nothing.
//
// Deliberately does NOT special-case "the active tab of this window is
// itself a StagePay project" as automatically unambiguous — an earlier
// version did, on the theory that looking straight at a project's own tab
// can't be confusing. Confirmed live that it's still a real risk: the
// conflict warning only ever appeared when the active tab wasn't StagePay
// (e.g. on Flow), never when it WAS one of the two conflicting project
// tabs directly — even though a second, different project sitting open in
// another window is exactly the situation that risks an accidental
// upload/delete landing on the wrong project's data through this
// extension. So the one and only rule now: if more than one DISTINCT
// project id is open anywhere, always report the conflict — regardless of
// which tab happens to be focused when this runs.
async function detectOpenProjectId() {
  const tabs = await chrome.tabs.query({ url: `${API_BASE}/*` });
  const ids = [];
  for (const tab of tabs) {
    if (!tab.url) continue;
    const p = new URL(tab.url).searchParams.get('p');
    if (p && !ids.includes(p)) ids.push(p);
  }
  if (ids.length > 1) return { conflict: true, ids };
  return ids[0] || null;
}

// Loads: (a) the project list, purely to read this one project's
// current_stage/completed — the same "highest locked stage, +1 if locked"
// formula GET /api/projects already computes server-side, reused instead of
// re-implemented; (b) the project detail (brief + items + versions); (c)
// that stage's config (fieldsSchema/outputInstructions/universalStyle), if
// not already cached.
async function loadProject() {
  // hasDirectorAccess is already known by the time this runs — checkAccountAccess()
  // (called from refreshFromActiveTab, before project detection even starts)
  // is the only place that fetches /auth/me now; a second fetch here would
  // just be redundant, since this function is never reached at all unless
  // that check already returned 'ok'.
  const [listRes, detailRes] = await Promise.all([
    fetch(`${API_BASE}/api/projects`, { credentials: 'include' }),
    fetch(`${API_BASE}/api/projects/${currentProjectId}`, { credentials: 'include' }),
  ]);
  if (listRes.status === 401 || detailRes.status === 401) {
    setStatus('Not logged in — log into StagePay in a normal tab first, then reopen this panel.', 'error', '🔒 Not logged in');
    landingIntroEl.hidden = false;
    currentItems = [];
    return;
  }
  if (!listRes.ok || !detailRes.ok) {
    setStatus(`Could not load project (${listRes.status}/${detailRes.status}).`, 'error', "⚠️ Couldn't load project");
    landingIntroEl.hidden = false;
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

  // Names the account explicitly rather than just "Connected" — with
  // multiple StagePay accounts in play across different Chrome profiles
  // (see the earlier multi-project conflict work), it's useful to see at a
  // glance whose Director session this panel is actually running under.
  setStatus(`Connected to ${currentUserEmail || 'your account'}`, 'ok'); // project + stage now live once, in the stage banner below — no need to repeat it here
  landingIntroEl.hidden = true;
  // The gallery is scoped to the CURRENT project's own subfolder (see
  // scanDownloadsFolder) — without this, switching to a different project
  // would keep showing whatever the previous project's scan left behind
  // until the next unrelated rescan trigger (a new download, the manual
  // button) happened to fire.
  if (downloadsDirHandle && folderPermissionState === 'granted') await scanDownloadsFolder();
}

function itemById(id) { return currentItems.find((i) => i.id === id) || null; }
function theVersion(item) { return (item && item.versions && item.versions[0]) || { prompt: '', media_files: [], fields: {} }; }
function itemConfigFor(item) {
  const sc = stageConfigCache[item.stage];
  return (sc && sc.items && sc.items[item.item_key]) || null;
}
function itemDisplayName(item) {
  const ic = itemConfigFor(item);
  return item.name || (ic && ic.label) || item.item_key;
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

// Kept in sync by hand with background.js's own copy (separate execution
// contexts, can't share code) — MUST produce identical output in both
// places, since background.js uses this to decide where a Flow download
// actually lands on disk, and panel.js uses it to decide where to look for
// it afterward. Deliberately keeps spaces in the name portion (unlike
// cleanUploadFileName's dash-ified item names) — this becomes a real folder
// name the customer browses by hand for backup/reference, so it should
// still read as the project's actual name.
//
// Always tags on a short id fragment (the project's own first 8 UUID
// characters) rather than relying on the name alone — confirmed live that
// two DIFFERENT projects sharing a name (renamed to match, or an old
// project's name reused later) would otherwise resolve to the exact same
// physical folder: Chrome's own conflictAction: 'uniquify' only dedupes
// individual FILE names, never folder paths, so their downloads would
// silently land mixed together with no error at all. The id fragment makes
// that collision structurally impossible. One side effect, accepted as a
// reasonable tradeoff: renaming a project mid-way still creates a new
// (differently-named-but-same-id-tagged) folder rather than reusing the old
// one, since the human-readable portion changes — the old folder's files
// aren't lost, just no longer the one new downloads or the gallery use.
function sanitizeProjectFolderName(name, id) {
  const cleanedName = (name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .trim()
    .replace(/[.\s]+$/, '')
    .slice(0, 60)
    .trim();
  const idFragment = (id || '').slice(0, 8);
  if (!idFragment) return cleanedName || null; // no id known yet — nothing to tag, fall back to name-only
  return cleanedName ? `${cleanedName} (${idFragment})` : idFragment;
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

// Single source of truth for "which Character/Property/Background items are
// featured in this scene" — a scene reads its OWN fields.refs; a movie
// reads its PARENT scene's fields.refs (a movie has no refs of its own).
// Always resolved live from theVersion(...).fields.refs, never from a
// Setup-form draft — "Featured in this scene" is set immediately by a
// separate refs-picker modal that saves to the server right away, so a
// draft's copy of `.refs` would just be a one-time snapshot from whenever
// that draft was first created, going stale on every later change.
//
// Both mustAttachFiles (which FILES to attach) and compilePrompt (which
// NAMES/descriptions to write into the prompt text) call this SAME
// function — confirmed live that having each resolve refs independently is
// exactly how they drifted out of sync with each other before: fixing one
// copy silently left the other one still reading stale data. One shared
// resolution makes that class of bug structurally impossible now.
function featuredRefItemsFor(item) {
  const scene = item.item_key === 'scene' ? item : item.item_key === 'movie' ? itemById(item.parent_item_id) : null;
  if (!scene) return [];
  const refIds = Array.isArray(theVersion(scene).fields.refs) ? theVersion(scene).fields.refs : [];
  return refIds.map((id) => itemById(id)).filter(Boolean);
}

// "Every file this item needs ALREADY attached as visual input before
// generating," not this item's own (not-yet-produced) output. Kept in
// exact parity with index.html's version so a Scene/Movie's reference list
// here always matches what the web app itself would show.
function mustAttachFiles(item) {
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
    const refFiles = featuredRefItemsFor(item).flatMap((ref) => withIcon(itemMediaFiles(ref), ''));
    return [...refFiles, ...logoFiles()];
  }
  if (item.item_key === 'movie') {
    const scene = itemById(item.parent_item_id);
    const refFiles = featuredRefItemsFor(item).flatMap((ref) => withIcon(itemMediaFiles(ref), ''));
    const soundFiles = currentItems.filter((i) => i.stage === 3 && i.item_key === 'sound').flatMap((s) => withIcon(itemMediaFiles(s), '🔊'));
    return [...(scene ? withIcon(itemMediaFiles(scene), '🎬') : []), ...refFiles, ...soundFiles];
  }
  return [];
}

// Storyboard + logo + product photos, shown as EXTRA optional visual
// references on every item type (except Story itself, which IS the
// storyboard) — so nobody has to leave the extension to check the brand's
// look. Deliberately kept OUT of mustAttachFiles/compilePrompt's own
// "Reference images: ..." text line: unlike a Scene's featured character/
// prop/background (structurally required, reliably actually attached in
// Flow), these are genuinely optional — the designer decides per item
// whether to use them. Promising them in the compiled prompt text risks a
// mismatch (text says a file is attached, designer didn't attach it in
// Flow) that can render an inconsistent scene — wasted AI credits, exactly
// what this tool exists to prevent. Visual-only, thumbnail row use only.
function optionalExtraReferenceFiles(item) {
  if (item.item_key === 'story') return [];
  const b = currentBrief || {};
  const story = currentItems.find((i) => i.stage === 2 && i.item_key === 'story');
  const storyboardFiles = story ? (theVersion(story).media_files || []).map((f) => ({ ...f, icon: f.icon || '🖼️' })) : [];
  const logoFiles = (b.logo_media && b.logo_media.key) ? [{ ...b.logo_media, icon: '🏷️' }] : [];
  const productFiles = (b.product_photos || []).map((p) => ({ ...p, icon: '📷' }));
  return [...storyboardFiles, ...logoFiles, ...productFiles];
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
    case 'sound':
      base = f.description || '';
      break;
    case 'scene': {
      const refItems = featuredRefItemsFor(item);
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
  const files = mustAttachFiles(item);
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

// Same meta-prompt shape as index.html's buildItemChatGptPrompt — enhances
// the EXACT prompt already compiled/shown in this item's Template box
// (master template + universal style already baked in via
// composeFinalPrompt, so there's nothing left to separately re-explain).
// Deliberately invites clarifying questions instead of forcing a single
// forced answer: a one-shot "don't ask me anything, output only the
// result" instruction just made ChatGPT guess at blanks like
// "(camera angle)" instead of asking what was actually meant — asking a
// few targeted questions first, in the same chat, produces a genuinely
// better final prompt to copy back into Custom mode.
function buildChatGptMetaPrompt(item, fields) {
  const label = item.name || (itemConfigFor(item) || {}).label || item.item_key;
  // Sound isn't a Flow image prompt at all — it's a brief for a sound
  // designer or AI audio tool, so the framing/destination wording below
  // has to say that instead of falsely claiming "Google Flow."
  const isSound = item.item_key === 'sound';
  const artifact = isSound ? 'sound brief' : 'prompt';
  const currentPrompt = composeFinalPrompt(item, compilePrompt(item, fields));
  const files = mustAttachFiles(item);
  const fileNames = files.length ? files.map((f) => f.fileName).join(', ') : '(none attached yet)';
  return `I'm producing ${isSound ? `the sound brief for "${label}"` : `a "${label}" reference image`} for a UGC-style product ad video${isSound ? '' : ' in Google Flow'}.

Campaign brief: ${briefSummary()}

Here's the current compiled ${artifact} for this "${label}":
${currentPrompt || '(nothing compiled yet)'}

Reference files I already have attached: ${fileNames}

If anything above is genuinely ambiguous or missing (e.g. a blank placeholder like "(camera angle)", or a vague description), ask me up to 3-4 short questions about just those specific things — skip straight to the answer if nothing needs asking. Once I answer (or if you have no questions), reply with ONE improved version of this ${artifact}, ready to ${isSound ? 'hand to a sound designer or AI audio tool' : 'paste into Google Flow'}, in a single code block and nothing else outside it.`;
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
  renderFolderConnectModal();
  if (!currentProjectId) return;
  if (currentCompleted) {
    itemListEl.innerHTML = `<p class="stage-empty-note">🎉 This project is completed — every stage is locked and paid. Nothing left to produce.</p>`;
    return;
  }
  if (currentStage === 1) {
    itemListEl.innerHTML = `<p class="stage-empty-note">Stage 1 (Creative Brief) is filled in directly in StagePay itself — nothing to send to Flow yet. Once the brief is locked, reopen this panel.</p>`;
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
  // Once per render, not per item — a global query, so wiring it inside the
  // per-item loop above would double-attach listeners whenever more than
  // one item happens to be expanded at once.
  wireSeeAllButtons();
}

// ---------- downloads-folder gallery (File System Access API) ----------
// One folder, granted once, reused everywhere — see the file header for why
// showDirectoryPicker() is safe to rely on here despite the popup-specific
// bug report. The handle itself is stored in IndexedDB (structured-cloneable,
// unlike chrome.storage) so it survives the panel closing/reopening; only
// the underlying OS permission needs re-confirming per browser session.
const IDB_NAME = 'stagepay-director';
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
async function idbClearDirHandle() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Runs once at panel startup — silent (queryPermission never prompts), so
// no user gesture is needed just to check whether a previously granted
// folder is still usable this session.
async function tryRestoreDownloadsFolder() {
  try {
    const handle = await idbLoadDirHandle();
    if (!handle) return;
    // The name check inside connectDownloadsFolder() only runs for a fresh
    // pick — a handle saved before that validation existed (or otherwise
    // pointing at the wrong folder) would restore silently as 'granted'
    // forever, with no "Change folder" button left to fix it. Catch that
    // here too, on every restore, not just at the moment of a new connect.
    if (handle.name !== FLOW_DOWNLOADS_SUBFOLDER_HINT) {
      folderNameMismatch = handle.name;
      await idbClearDirHandle();
      folderPermissionState = 'none';
      render();
      return;
    }
    downloadsDirHandle = handle;
    const perm = await handle.queryPermission({ mode: 'read' });
    if (perm === 'granted') {
      folderPermissionState = 'granted';
      await scanDownloadsFolder();
    } else {
      folderPermissionState = 'needs-reconnect';
    }
    // init() calls this AFTER refreshFromActiveTab() has already rendered
    // once with the default 'none' state — without this, a previously
    // connected (or lapsed) folder wouldn't show correctly until some other
    // event happened to trigger a re-render.
    render();
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
//
// The name is mandatory, not just a suggestion: background.js only ever
// redirects Flow's downloads into FLOW_DOWNLOADS_SUBFOLDER_HINT, so a
// differently-named (or renamed) folder would silently stop receiving
// anything new — the exact bug that prompted this check.
async function connectDownloadsFolder() {
  try {
    const handle = await window.showDirectoryPicker({ startIn: 'downloads' });
    if (handle.name !== FLOW_DOWNLOADS_SUBFOLDER_HINT) {
      folderNameMismatch = handle.name;
      render();
      return;
    }
    folderNameMismatch = null;
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

// Scans the CURRENT project's own subfolder (background.js's download
// redirect creates one per project, named via sanitizeProjectFolderName on
// currentProjectName) rather than the flat top-level folder — this only
// shows files actually belonging to whatever project is open right now,
// instead of every project's downloads mixed together. Filters to
// image/video, sorts newest-first by the file's own lastModified, keeps
// only the most recent FOLDER_GALLERY_LIMIT.
//
// A project subfolder not existing yet (getDirectoryHandle throws
// NotFoundError) is the normal, expected state for a project with no
// downloads yet — it just leaves the gallery empty, WITHOUT setting
// folderPermissionState = 'missing', since that's reserved for the
// connected folder itself actually having been moved/deleted (a real
// problem the persistent connect-modal needs to surface). Files downloaded
// before this per-project scoping existed still sit in the flat top-level
// folder and won't show here anymore — they're not lost, just no longer
// picked up by this gallery going forward.
async function scanDownloadsFolder() {
  if (!downloadsDirHandle) return;
  revokeFolderThumbnails();
  const found = [];
  try {
    const projectFolder = sanitizeProjectFolderName(currentProjectName, currentProjectId);
    let scanHandle = downloadsDirHandle;
    if (projectFolder) {
      try {
        scanHandle = await downloadsDirHandle.getDirectoryHandle(projectFolder);
      } catch (e) {
        if (e.name === 'NotFoundError') { folderThumbnails = []; return; }
        throw e;
      }
    }
    for await (const [name, handle] of scanHandle.entries()) {
      if (handle.kind !== 'file') continue;
      const file = await handle.getFile();
      if (!FOLDER_GALLERY_MIME_PREFIXES.some((p) => file.type.startsWith(p))) continue;
      found.push({ name, file, lastModified: file.lastModified });
    }
  } catch (e) {
    // Previously silent — an empty gallery from a genuinely deleted/moved
    // folder looked identical to "nothing downloaded recently," which is
    // exactly the confusing case this state exists to catch.
    folderPermissionState = 'missing';
  }
  found.sort((a, b) => b.lastModified - a.lastModified);
  folderThumbnails = found.slice(0, FOLDER_GALLERY_LIMIT).map((f) => ({
    name: f.name, file: f.file, url: URL.createObjectURL(f.file),
  }));
}

// Filters the shared project-level scan down to just the files that
// actually belong to THIS item, by name — the mandatory rename prompt
// already names a file after its item (e.g. "Daughter.jpeg", or
// "Daughter (2).jpeg" for a Flow retry), so every item's own "Choose &
// send" gallery reuses that same convention instead of showing every
// item's files in every item's gallery. Confirmed live this matters a lot
// with 15 characters in one project — an unfiltered shared gallery becomes
// unusable clutter. A file that was never renamed (Flow's original name,
// or downloaded before this feature existed) won't match anything here —
// it's not lost, just not surfaced in any per-item gallery; it still shows
// up if you browse the actual folder on disk. Keeps each match's index
// into the ORIGINAL folderThumbnails array (globalIndex) — the thumbnail
// click handler in wireItemCard looks files up by that index, so a locally
// re-numbered index here would stage the wrong file.
function filesForItem(item) {
  const base = itemDisplayName(item).replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim();
  if (!base) return [];
  const prefix = base.toLowerCase();
  return folderThumbnails
    .map((t, i) => ({ ...t, globalIndex: i }))
    .filter((t) => {
      const stem = t.name.replace(/\.[a-zA-Z0-9]+$/, '').toLowerCase();
      return stem === prefix || stem.startsWith(`${prefix} (`);
    });
}

// Queues a just-completed download for the mandatory "which item is this
// for?" rename prompt — only if it landed in the CURRENTLY open project's
// own subfolder. If projectFolder is null (no project was known at download
// time) or belongs to a DIFFERENT project than the one open right now, it's
// deliberately left unprompted rather than guessed at — this panel only has
// that other project's item list loaded when that project is actually
// open, so there's no reliable list to offer. The file still sits safely in
// its own correct project folder either way, just with Flow's original name
// until renamed by hand or from within that project later.
//
// Also skipped entirely when the current stage has zero items to offer
// (Stage 1/Brief has no items at all, just fields) — since this modal has
// no skip/close button by design, showing it with nothing to click would be
// a dead end rather than a prompt.
function enqueueRenameIfCurrentProject(fileName, projectFolder) {
  if (!fileName) return;
  const myFolder = sanitizeProjectFolderName(currentProjectName, currentProjectId);
  if (!myFolder || projectFolder !== myFolder) return;
  if (!currentItems.some((i) => i.stage === currentStage)) return;
  // Captures projectFolder (and, at modal-render time, the stage/items list)
  // as of RIGHT NOW — if the user switches to a different project's tab
  // before answering (the panel keeps reacting to tab-focus events
  // regardless of this modal), renaming still targets the folder this file
  // actually landed in, not wherever the panel has since navigated to.
  pendingRenameFiles.push({ fileName, projectFolder });
  if (!renamingFile) showNextRenameModal();
}

function showNextRenameModal() {
  renamingFile = pendingRenameFiles.shift() || null;
  renderRenameFileModal();
}

// Mandatory, no-dismiss modal (mirrors renderFolderConnectModal's same
// forced pattern) — lists every item in whichever stage is CURRENTLY shown
// in the panel, by name, so picking one is as easy as matching what you see
// on Flow to what you see here (e.g. Stage 3 open → Character/Property/
// Background/Sound names; Stage 4 → Scene names; Stage 5 → Movie names).
function renderRenameFileModal() {
  const root = document.getElementById('renameFileModalRoot');
  if (!root) return;
  if (!renamingFile) { root.innerHTML = ''; return; }
  const items = currentItems.filter((i) => i.stage === currentStage);
  root.innerHTML = `<div class="status-modal-overlay">
    <div class="status-modal-card rename-file-modal-card">
      <h2>📁 Which item is this file for?</h2>
      <p>"${escapeHtml(renamingFile.fileName)}" just landed in your downloads folder — pick the item it belongs to and it'll be renamed so it's easy to find later.</p>
      <div class="rename-file-modal-list">
        ${items.map((it) => `<button type="button" data-rename-choice="${it.id}">${escapeHtml(itemDisplayName(it))}</button>`).join('')}
      </div>
    </div>
  </div>`;
  items.forEach((it) => {
    const btn = root.querySelector(`[data-rename-choice="${it.id}"]`);
    if (btn) btn.addEventListener('click', () => handleRenameChoice(it));
  });
}

async function handleRenameChoice(item) {
  const { fileName, projectFolder } = renamingFile;
  try {
    await renameDownloadedFile(fileName, item, projectFolder);
  } catch (e) {
    openUploadErrorModal(`Couldn't rename "${fileName}" to match "${itemDisplayName(item)}" — ${e && e.message ? e.message : 'you can rename it by hand in your downloads folder.'}`);
  }
  await scanDownloadsFolder();
  render();
  showNextRenameModal();
}

// Renames in place via the File System Access API's move() — needs a
// one-time read-write permission upgrade on the already-connected folder
// (a fresh prompt, not a manifest change, so no new Web Store review).
// Collisions (e.g. a Flow retry for the same item) suffix with " (2)",
// " (3)"... rather than overwrite, so an earlier keeper is never silently
// lost — capped at a sane number of attempts rather than looping forever.
// projectFolder is the one captured at enqueue time (see
// enqueueRenameIfCurrentProject), NOT recomputed from currentProjectName —
// that project may no longer be the one open in the panel by the time this
// runs.
async function renameDownloadedFile(fileName, item, projectFolder) {
  if (!downloadsDirHandle) return;
  const perm = await downloadsDirHandle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw new Error('write permission for the downloads folder was not granted');
  const dirHandle = projectFolder ? await downloadsDirHandle.getDirectoryHandle(projectFolder) : downloadsDirHandle;
  const fileHandle = await dirHandle.getFileHandle(fileName);
  const extMatch = fileName.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : 'dat';
  const base = itemDisplayName(item).replace(/[\\/:*?"<>|\x00-\x1f]/g, '').trim() || 'file';
  let target = `${base}.${ext}`;
  for (let n = 2; n <= 50 && target !== fileName && (await fileExistsIn(dirHandle, target)); n++) {
    target = `${base} (${n}).${ext}`;
  }
  if (typeof fileHandle.move === 'function') {
    await fileHandle.move(target);
  } else {
    // Older Chrome without FileSystemFileHandle.move() — copy the bytes to
    // the new name, then remove the original.
    const file = await fileHandle.getFile();
    const newHandle = await dirHandle.getFileHandle(target, { create: true });
    const writable = await newHandle.createWritable();
    await writable.write(file);
    await writable.close();
    await dirHandle.removeEntry(fileName);
  }
}

async function fileExistsIn(dirHandle, name) {
  try { await dirHandle.getFileHandle(name); return true; } catch (e) { return false; }
}

// Forces the folder connection: the whole point of this extension is
// auto-showing Flow's downloads, so an unconnected/lapsed/missing folder
// silently defeats it — shown every time that's true, no dismiss, since
// this extension is an AI-creator-only tool with no audience to annoy
// (filmed creators never install it at all).
function renderFolderConnectModal() {
  const root = document.getElementById('folderConnectModalRoot');
  if (!root) return;
  const shouldShow = currentProjectId && !currentCompleted && currentStage !== 1
    && folderPermissionState !== 'granted';
  if (!shouldShow) { root.innerHTML = ''; return; }

  const isMissing = folderPermissionState === 'missing';
  const isReconnect = folderPermissionState === 'needs-reconnect';
  const title = isMissing
    ? "⚠️ Downloads folder can't be found"
    : isReconnect
    ? '🔓 Reconnect your downloads folder'
    : '🔗 Connect your downloads folder';
  const message = isMissing
    ? `The "${FLOW_DOWNLOADS_SUBFOLDER_HINT}" folder you connected seems to have been moved, renamed, or deleted. Flow's downloads won't show up here automatically until you reconnect it.`
    : isReconnect
    ? `Your previously connected folder needs permission confirmed again this browser session before Flow's downloads will show up here automatically.`
    : `Without this, Flow's downloads won't show up here automatically — you'll need to pick files manually every time.`;
  // The name is mandatory (background.js's redirect target is hardcoded),
  // and the folder itself only exists once something's been downloaded from
  // Flow or the user makes it by hand — spelled out here since the picker
  // won't show it until one of those happens.
  const nameNote = !isReconnect
    ? `Create a folder named exactly "${FLOW_DOWNLOADS_SUBFOLDER_HINT}" inside Downloads (click "New Folder" in the picker, or make it beforehand in Finder/Explorer), then select it below — that's the one folder Flow's downloads get redirected into.`
    : '';
  const mismatchNote = folderNameMismatch
    ? `You picked "${folderNameMismatch}" — that won't work. It has to be named exactly "${FLOW_DOWNLOADS_SUBFOLDER_HINT}", or Flow's downloads will keep landing somewhere this extension isn't watching.`
    : '';

  root.innerHTML = `<div class="folder-connect-modal-overlay">
    <div class="folder-connect-modal-card">
      <h2>${title}</h2>
      <p>${escapeHtml(message)}</p>
      ${nameNote ? `<p class="folder-connect-modal-hint">${escapeHtml(nameNote)}</p>` : ''}
      ${mismatchNote ? `<p class="folder-connect-modal-hint folder-connect-modal-error">${escapeHtml(mismatchNote)}</p>` : ''}
      <button type="button" id="folderConnectModalBtn">${isReconnect ? '🔓 Reconnect folder' : '🔗 Connect folder'}</button>
    </div>
  </div>`;
  const btn = document.getElementById('folderConnectModalBtn');
  if (btn) btn.addEventListener('click', () => {
    if (isReconnect) reconnectDownloadsFolder(); else connectDownloadsFolder();
  });
}

function renderFieldControl(def, value) {
  const path = def.key;
  if (def.type === 'pill') {
    // Mirrors index.html's same optionHelp -> title pattern — a hover
    // tooltip explaining what/when/example for each option, for options
    // that aren't self-explanatory (e.g. "POV", "Dutch Angle").
    return `<div class="setup-field"><label>${escapeHtml(def.label)}</label><div class="pill-row">
      ${def.options.map((o) => `<button type="button" class="${o === value ? 'selected' : ''}" data-field-pick="${path}" data-value="${escapeHtml(o)}"${def.optionHelp && def.optionHelp[o] ? ` title="${escapeHtml(def.optionHelp[o])}"` : ''}>${escapeHtml(o)}</button>`).join('')}
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
  if (showPrompt && promptMode === 'template') {
    // Template mode is always derived and read-only — never hand-edited —
    // so unlike draft.fields (which protects an in-progress Setup edit),
    // draft.prompt has nothing worth preserving across renders. Recompiling
    // it fresh on every render is what stops it going stale the same way
    // refs used to: "Featured in this scene" can change at any time from
    // the web app's separate refs modal, with nothing telling this panel to
    // recompute — so the cached prompt from the last render/save just kept
    // showing whichever references were featured as of the very first
    // compile, even after Save (the same stale-cache bug class, just in the
    // prompt textarea instead of mustAttachFiles/compilePrompt's own logic).
    draft.prompt = composeFinalPrompt(item, compilePrompt(item, draft.fields));
  }
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
        <button type="button" class="see-all-btn" data-see-all-btn data-see-all-for="${item.id}" data-see-all-kind="must-attach">🔍 See all</button>
        ${promptMode === 'custom'
          ? `<p class="prompt-mode-note">Your own prompt/template — nothing here ever auto-changes it.</p>`
          : (schema.length ? `<p class="prompt-mode-note">Read-only — mirrors Setup above exactly. Switch to Custom to write or paste your own.</p>` : '')}
        <textarea data-prompt-area="${item.id}" ${promptMode === 'template' ? 'readonly' : ''} placeholder="${promptMode === 'custom' ? 'Paste your custom prompt here...' : 'Edit Setup above to fill this in...'}">${escapeHtml((promptMode === 'custom' ? draft.fields._customPrompt : draft.prompt) || '')}</textarea>
        <div class="row">
          <button type="button" data-copy-prompt-btn="${item.id}">📋 Copy prompt</button>
          <button type="button" data-chatgpt-btn="${item.id}">🤖 Enhance Prompt With ChatGPT</button>
          <button type="button" class="primary" data-save-draft-btn="${item.id}">💾 Save</button>
        </div>`,
    });
  }

  const staged = stagingFiles[item.id] || [];
  const folderGalleryHtml = (() => {
    if (folderPermissionState === 'granted') {
      const myFiles = filesForItem(item);
      const galleryItems = myFiles.length
        ? `<div class="folder-gallery-row" data-folder-gallery-row="${item.id}">${myFiles.map((t) => {
            const isSelected = staged.includes(t.file);
            const isVideo = t.file.type.startsWith('video');
            const media = isVideo ? `<video src="${t.url}" muted></video>` : `<img src="${t.url}">`;
            const videoBadge = isVideo ? `<span class="video-badge">▶</span>` : '';
            return `<div class="folder-gallery-wrap${isSelected ? ' selected' : ''}" data-folder-thumb="${item.id}" data-index="${t.globalIndex}" title="${escapeHtml(t.name)}">${media}${videoBadge}${isSelected ? `<span class="folder-gallery-tick">✓</span>` : ''}</div>`;
          }).join('')}</div>`
        : `<p class="folder-gallery-empty">No downloads matching "${escapeHtml(itemDisplayName(item))}" yet — click 🔄 after downloading and naming one for this item.</p>`;
      const projectFolder = sanitizeProjectFolderName(currentProjectName, currentProjectId);
      const connectedLabel = downloadsDirHandle ? `${downloadsDirHandle.name}${projectFolder ? ` / ${projectFolder}` : ''}` : '';
      return `<div class="folder-gallery-head"><strong>🔗 Connected: ${escapeHtml(connectedLabel)}</strong><button type="button" data-rescan-folder-btn>🔄 Rescan</button></div>${galleryItems}${myFiles.length ? `<button type="button" class="see-all-btn" data-see-all-btn data-see-all-for="${item.id}" data-see-all-kind="folder-gallery">🔍 See all</button>` : ''}<p class="folder-gallery-empty">Click a thumbnail to select/deselect it — ticked ones are what "Send" below will upload.</p>`;
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
      ${staged.length ? `<button type="button" class="see-all-btn" data-see-all-btn data-see-all-for="${item.id}" data-see-all-kind="staging">🔍 See all</button>` : ''}
      <p class="staging-note" data-staging-note="${item.id}" ${stagingNotes[item.id] ? '' : 'hidden'}>${escapeHtml(stagingNotes[item.id] || '')}</p>
      <div class="row" data-staging-actions="${item.id}" ${staged.length ? '' : 'hidden'}>
        <button type="button" class="primary" data-send-staged-btn="${item.id}">⬆ Send ${staged.length} ${escapeHtml(itemDisplayName(item))} file(s) to StagePay</button>
      </div>`,
  });

  const currentFiles = theVersion(item).media_files || [];
  steps.push({
    title: `${noun} Deliverable`,
    body: `
      <div class="thumb-row" data-thumbs="${item.id}"></div>
      ${currentFiles.length ? `<button type="button" class="see-all-btn" data-see-all-btn data-see-all-for="${item.id}" data-see-all-kind="thumbs">🔍 See all</button>` : `<p class="deliverable-empty">Nothing sent yet — pick and send a file above.</p>`}`,
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
//
// Only the required files (mustAttachFiles — what's actually named in the
// compiled prompt's "Featuring: ..."/"Reference images: ..." text) get a
// copy button. Extras (optionalExtraReferenceFiles — storyboard, product
// photos) are shown dimmed/dashed with no copy button at all: they're
// deliberately never named in the prompt text (see that function's own
// comment), so copying one into Flow wouldn't match anything the prompt
// says — it'd just be an unlabeled extra image Flow has no textual cue to
// weight correctly. Keeping copy limited to what the prompt actually
// promises is what stops a designer from pasting the wrong set of images.
async function loadMustAttach(item) {
  const row = document.querySelector(`[data-must-attach="${item.id}"]`);
  if (!row) return;
  const required = mustAttachFiles(item);
  // Extras appended after, deduped by storage key — the visual row is the
  // only place these optional references show; compilePrompt/ChatGPT text
  // generation still call mustAttachFiles directly and never see them.
  const extras = optionalExtraReferenceFiles(item).filter((f) => !required.some((r) => r.key === f.key));
  const files = [...required.map((f) => ({ f, isExtra: false })), ...extras.map((f) => ({ f, isExtra: true }))];
  for (const { f, isExtra } of files) {
    try {
      const mediaUrl = `${API_BASE}/api/media/${f.key}`;
      const r = await fetch(mediaUrl, { credentials: 'include' });
      if (!r.ok) continue;
      const blob = await r.blob();
      if (!blob.type.startsWith('image/')) continue;
      const wrap = document.createElement('div');
      wrap.className = isExtra ? 'must-attach-wrap must-attach-wrap-extra' : 'must-attach-wrap';
      const img = document.createElement('img');
      img.src = mediaUrl;
      img.title = isExtra ? `${f.fileName} (for your own reference — not named in the prompt)` : f.fileName;
      wrap.appendChild(img);
      if (!isExtra) {
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
        wrap.appendChild(copyBtn);
      }
      row.appendChild(wrap);
    } catch (e) { /* skip a file that failed to load */ }
  }
}

// "See all" reads whatever's already rendered in a given row rather than
// tracking a separate list — every thumbnail here is a real <img>/<video>
// with its src already set by the time a user could click the button, so
// there's nothing to keep in sync, just read the DOM at click time.
function collectRowMedia(row) {
  if (!row) return [];
  return Array.from(row.querySelectorAll('img, video')).map((el) => ({
    url: el.src,
    kind: el.tagName === 'VIDEO' ? 'video' : 'image',
    title: el.title || '',
  }));
}

// Bigger, on-demand view of a whole row at once — built specifically so
// thumbnails (40-52px, several overlapping overlay buttons already) don't
// also need a per-thumbnail enlarge icon crammed onto them. Videos open
// paused with native controls, never autoplaying.
function openMediaGalleryModal(title, items) {
  const root = document.getElementById('galleryModalRoot');
  if (!root || !items.length) return;
  root.innerHTML = `<div class="gallery-modal-overlay" id="galleryModalOverlay">
    <div class="gallery-modal-card">
      <div class="gallery-modal-head"><strong>${escapeHtml(title)}</strong><button type="button" id="galleryModalCloseBtn">×</button></div>
      <div class="gallery-modal-grid">
        ${items.map((it) => it.kind === 'video'
          ? `<video src="${it.url}" controls title="${escapeHtml(it.title)}"></video>`
          : `<img src="${it.url}" title="${escapeHtml(it.title)}">`).join('')}
      </div>
    </div>
  </div>`;
  const close = () => { root.innerHTML = ''; };
  document.getElementById('galleryModalCloseBtn').addEventListener('click', close);
  document.getElementById('galleryModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'galleryModalOverlay') close(); });
}

// addToStaging()'s validation messages also land in the small inline
// staging-note text, but that's easy to blow past when rapid-clicking to
// get files uploaded — confirmed live: users kept re-clicking "Send" without
// noticing why nothing happened. This blocks on the same message instead of
// just quietly printing it, then leaves the inline note in place underneath
// (still rendered from stagingNotes as before) as a persistent reminder once
// the modal's dismissed, in case the user forgets what it said.
function openUploadErrorModal(message) {
  const root = document.getElementById('uploadErrorModalRoot');
  if (!root) return;
  root.innerHTML = `<div class="gallery-modal-overlay" id="uploadErrorModalOverlay">
    <div class="gallery-modal-card upload-error-modal-card">
      <div class="gallery-modal-head"><strong>⚠ Couldn't add file(s)</strong><button type="button" id="uploadErrorModalCloseBtn">×</button></div>
      <p class="upload-error-modal-body">${escapeHtml(message)}</p>
      <button type="button" class="upload-error-modal-ok" id="uploadErrorModalOkBtn">OK</button>
    </div>
  </div>`;
  const close = () => { root.innerHTML = ''; };
  document.getElementById('uploadErrorModalCloseBtn').addEventListener('click', close);
  document.getElementById('uploadErrorModalOkBtn').addEventListener('click', close);
  document.getElementById('uploadErrorModalOverlay').addEventListener('click', (e) => { if (e.target.id === 'uploadErrorModalOverlay') close(); });
}

const SEE_ALL_ROW_SELECTOR = {
  'must-attach': (id) => `[data-must-attach="${id}"]`,
  'thumbs': (id) => `[data-thumbs="${id}"]`,
  'staging': (id) => `[data-staging="${id}"]`,
  // Scoped by item id, unlike the unscoped selector this replaced — now
  // that each item's own gallery shows DIFFERENT files (see filesForItem),
  // an unscoped ".folder-gallery-row" would grab whichever item's row
  // happens to be first in the DOM if more than one item card is expanded
  // at once, showing the wrong item's "See all" (harmless before this
  // filtering existed, since every row showed identical content).
  'folder-gallery': (id) => `[data-folder-gallery-row="${id}"]`,
};
const SEE_ALL_TITLE = {
  'must-attach': 'Reference images',
  'thumbs': 'Deliverable',
  'staging': 'Staged to send',
  'folder-gallery': 'Downloads folder',
};
function wireSeeAllButtons() {
  document.querySelectorAll('[data-see-all-btn]').forEach((btn) => btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-see-all-for');
    const kind = btn.getAttribute('data-see-all-kind');
    const row = document.querySelector(SEE_ALL_ROW_SELECTOR[kind](id));
    const items = collectRowMedia(row);
    if (!items.length) return;
    openMediaGalleryModal(SEE_ALL_TITLE[kind], items);
  }));
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
        console.error('[StagePay Director] clipboard copy failed', e);
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
  if (notes.length) openUploadErrorModal(notes.join(' '));
}

function updateStagingActions(itemId) {
  const actionsEl = document.querySelector(`[data-staging-actions="${itemId}"]`);
  const btn = document.querySelector(`[data-send-staged-btn="${itemId}"]`);
  const count = (stagingFiles[itemId] || []).length;
  if (actionsEl) actionsEl.hidden = count === 0;
  // Names the item in the button itself (not just the section title above
  // it) — confirmed as a real human-error risk with many similar items
  // (e.g. 15 characters) open at once: StagePay is what actually reaches
  // the customer, so the button you click to send should say exactly what
  // it's about to send, not a generic count.
  const item = itemById(itemId);
  if (btn) btn.textContent = `⬆ Send ${count} ${item ? itemDisplayName(item) : ''} file(s) to StagePay`;
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
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = `Uploading ${itemDisplayName(item)} ${i + 1}/${files.length}…`; }
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
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = `Upload failed on ${itemDisplayName(item)} file ${i + 1} — try again`; }
      stagingFiles[itemId] = files.slice(i); // keep whatever didn't make it, so nothing's silently lost
      renderStaging(item);
      updateStagingActions(itemId);
      openUploadErrorModal(`Upload failed on ${itemDisplayName(item)} file ${i + 1} of ${files.length} ("${file.name}") — the rest weren't sent either. Try again.`);
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
// the gallery updates itself with no manual "Rescan" click needed. Also
// carries the actual saved fileName + which project's subfolder it landed
// in, so the mandatory rename prompt (see enqueueRenameIfCurrentProject)
// knows exactly which file to ask about.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'stagepay-director-download-ready' && folderPermissionState === 'granted') {
    scanDownloadsFolder().then(render);
    enqueueRenameIfCurrentProject(message.fileName, message.projectFolder || null);
    return;
  }
  // background.js's own copy of the current project can be silently reset
  // if its service worker was evicted while idle (see that file's comment
  // on currentProjectName) — it asks here, live, at the exact moment of a
  // download, rather than relying solely on the earlier push from
  // setStatus(). Answered synchronously, straight from this page's own
  // in-memory state — no fetch, no delay.
  if (message && message.type === 'stagepay-director-query-project') {
    sendResponse({ name: currentProjectId ? currentProjectName : null, id: currentProjectId });
  }
});

init();

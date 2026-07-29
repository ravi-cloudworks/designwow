// StagePay Director — background service worker (Manifest V3).
//
// A full download-capture feature (auto-detect a Flow download and attach it
// with zero picker interaction) was prototyped and deliberately dropped:
// Flow saves from a blob: URL scoped to its own page and revokes it
// immediately after triggering the download, before an extension can react —
// confirmed by testing, not a guess. The one way around that (a persistent
// script patching URL.createObjectURL on Flow's page, capturing the Blob at
// creation time — the same technique third-party watermark-remover
// extensions like Erasio use) crosses further into "always-on presence on
// Flow's page" than intended for this tool.
//
// What the panel does instead (see panel.js): once a folder is connected via
// showDirectoryPicker() (confirmed working from the side panel — see
// STAGEPAY_SWIMLANE_EXTENSION_PLAN.md for why an earlier bug report wrongly
// suggested otherwise), it shows a real thumbnail gallery of that folder's
// recent images/videos — click one to stage it, no OS file dialog needed.
//
// The remaining gap: Chrome won't let showDirectoryPicker() grant access to
// Downloads itself (or Desktop/Documents/home) — those are deliberately
// blocked "sensitive" directories, so every Flow download still lands in
// the ordinary Downloads folder regardless of what the panel is connected
// to. This file closes that gap: chrome.downloads.onDeterminingFilename
// auto-redirects any download whose referrer is Flow's own domain
// (labs.google — confirmed from the user's own Chrome download history,
// not guessed) into a subfolder inside Downloads. A subfolder isn't one of
// the blocked top-level directories, so the panel CAN be connected to it —
// meaning only Flow's own output ever lands where the gallery is watching;
// everything else downloaded in this browser is untouched.

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.sidePanel.open({ tabId: tab.id });
});

const FLOW_REFERRER_MATCH = /labs\.google/i;
const FLOW_DOWNLOADS_SUBFOLDER = 'StagePayDirector';

// Downloads redirected into the subfolder, awaiting completion — lets
// onChanged below tell the panel to rescan only for these, not every
// download in the browser.
const redirectedDownloadIds = new Set();
// downloadId -> the projectFolder used for its redirect (captured in
// onDeterminingFilename, read back in onChanged) — the panel's mandatory
// rename prompt needs to know exactly which project subfolder a completed
// download landed in, and by the time it completes currentProjectName may
// have already moved on to a different project.
const redirectedDownloadFolders = new Map();

// Which project's own subfolder new downloads should land in — kept
// in-memory only, not chrome.storage: a plain runtime message from
// panel.js (see setStatus() there) is enough, and avoids needing a new
// "storage" permission (and the Web Store re-review that would trigger).
//
// Confirmed live that the obvious tradeoff of doing this in-memory-only is
// worse than expected: a MV3 service worker can be evicted after even a
// short idle period, and on its next wake the ENTIRE script re-executes
// from scratch — silently resetting currentProjectName/currentProjectId
// back to null, with no way for the panel (a separate page, not subject to
// this eviction) to know it happened. If nothing else happens to re-trigger
// a fresh push before the next download, that download falls back to the
// flat top-level folder even though the panel itself is still showing the
// right project. onDeterminingFilename below covers this: if its own copy
// is empty when a download fires, it asks the panel directly instead of
// assuming "unknown" means "no project."
let currentProjectName = null;
let currentProjectId = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'stagepay-director-set-project') {
    currentProjectName = msg.name || null;
    currentProjectId = msg.id || null;
  }
});

// Kept in sync by hand with panel.js's identical copy — see that file's
// version for the full rationale (name sanitizing + the id-fragment
// collision fix). MUST stay byte-for-byte identical, since this decides
// where a file actually lands and panel.js's copy decides where to look for
// it afterward.
function sanitizeProjectFolderName(name, id) {
  const cleanedName = (name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .trim()
    .replace(/[.\s]+$/, '')
    .slice(0, 60)
    .trim();
  const idFragment = (id || '').slice(0, 8);
  if (!idFragment) return cleanedName || null;
  return cleanedName ? `${cleanedName} (${idFragment})` : idFragment;
}

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  const source = downloadItem.referrer || downloadItem.url || '';
  if (!FLOW_REFERRER_MATCH.test(source)) return; // not from Flow — leave Chrome's own default alone
  const originalName = (downloadItem.filename || '').split(/[\\/]/).pop() || 'download';
  redirectedDownloadIds.add(downloadItem.id);

  const finish = (name, id) => {
    const projectFolder = sanitizeProjectFolderName(name, id);
    redirectedDownloadFolders.set(downloadItem.id, projectFolder);
    const path = projectFolder
      ? `${FLOW_DOWNLOADS_SUBFOLDER}/${projectFolder}/${originalName}`
      : `${FLOW_DOWNLOADS_SUBFOLDER}/${originalName}`;
    suggest({ filename: path, conflictAction: 'uniquify' });
  };

  if (currentProjectId) {
    finish(currentProjectName, currentProjectId);
    return; // suggest() already called synchronously above — no need to signal async
  }

  // Own copy is empty — most likely this service worker was evicted and
  // just woke up fresh (see the comment on currentProjectName above), not
  // that there's genuinely no project open. Ask the panel directly instead
  // of assuming the flat top-level folder is correct. If the panel isn't
  // open at all, sendMessage's callback still fires (with
  // chrome.runtime.lastError set) — checking it here avoids an "Unchecked
  // runtime.lastError" console warning, and falls back to the flat folder
  // exactly as before.
  chrome.runtime.sendMessage({ type: 'stagepay-director-query-project' }, (response) => {
    void chrome.runtime.lastError; // panel not open — expected, not an error
    finish(response && response.name, response && response.id);
  });
  return true; // suggest() will be called asynchronously above
});

// No folder-watch API exists for a granted directory — this is the actual
// automatic-rescan trigger: the moment a redirected download finishes, tell
// the panel (if open) to re-scan right now. If the panel isn't open,
// sendMessage just fails quietly — nothing to catch up on until it reopens,
// at which point it scans on its own anyway. Also looks up the download's
// own actual saved filename via chrome.downloads.search() — Chrome's own
// conflictAction: 'uniquify' may have altered it from what was suggested
// above (e.g. a same-named file already existed) — so the panel's rename
// prompt always operates on the real filename on disk, not a guess.
chrome.downloads.onChanged.addListener((delta) => {
  if (!redirectedDownloadIds.has(delta.id)) return;
  if (delta.state && delta.state.current === 'complete') {
    redirectedDownloadIds.delete(delta.id);
    const projectFolder = redirectedDownloadFolders.get(delta.id) || null;
    redirectedDownloadFolders.delete(delta.id);
    chrome.downloads.search({ id: delta.id }).then(([item]) => {
      const fileName = item && item.filename ? item.filename.split(/[\\/]/).pop() : null;
      chrome.runtime.sendMessage({ type: 'stagepay-director-download-ready', fileName, projectFolder }).catch(() => {});
    });
  }
});

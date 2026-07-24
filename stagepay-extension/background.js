// StagePay Bridge — background service worker (Manifest V3).
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
const FLOW_DOWNLOADS_SUBFOLDER = 'StagePayBridge';

// Downloads redirected into the bridge subfolder, awaiting completion — lets
// onChanged below tell the panel to rescan only for these, not every
// download in the browser.
const redirectedDownloadIds = new Set();

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  const source = downloadItem.referrer || downloadItem.url || '';
  if (!FLOW_REFERRER_MATCH.test(source)) return; // not from Flow — leave Chrome's own default alone
  const originalName = (downloadItem.filename || '').split(/[\\/]/).pop() || 'download';
  redirectedDownloadIds.add(downloadItem.id);
  suggest({ filename: `${FLOW_DOWNLOADS_SUBFOLDER}/${originalName}`, conflictAction: 'uniquify' });
});

// No folder-watch API exists for a granted directory — this is the actual
// automatic-rescan trigger: the moment a redirected download finishes, tell
// the panel (if open) to re-scan right now. If the panel isn't open,
// sendMessage just fails quietly — nothing to catch up on until it reopens,
// at which point it scans on its own anyway.
chrome.downloads.onChanged.addListener((delta) => {
  if (!redirectedDownloadIds.has(delta.id)) return;
  if (delta.state && delta.state.current === 'complete') {
    redirectedDownloadIds.delete(delta.id);
    chrome.runtime.sendMessage({ type: 'stagepay-bridge-download-ready' }).catch(() => {});
  }
});

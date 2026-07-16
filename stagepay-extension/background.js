// StagePay Companion — background service worker (Manifest V3).
// The panel does all its own work directly against stagepay-api; this file's
// only job is opening the side panel when the toolbar icon is clicked.
//
// A download-capture feature (auto-detect a Flow download and attach it
// without a file picker) was prototyped and deliberately dropped: Flow saves
// from a blob: URL scoped to its own page and revokes it immediately after
// triggering the download, before an extension can react — confirmed by
// testing, not a guess. The one way around that (a persistent script
// patching URL.createObjectURL on Flow's page, capturing the Blob at
// creation time) crosses further into "always-on presence on Flow's page"
// than intended for this tool, so the manual dropzone in the panel is the
// one supported path for getting Flow's output into StagePay.

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.sidePanel.open({ tabId: tab.id });
});

// StagePay Companion — side panel logic.
// This talks ONLY to stagepay-api (via the stagepay.pages.dev proxy, same
// endpoints the web app itself uses) and to chrome.storage.session (for
// downloads background.js has spotted). It never touches Google Flow's page.
//
// Auth model: no separate login here at all. If you're logged into StagePay
// in a normal browser tab, this panel's fetch() calls reuse that same
// session cookie (credentials: 'include' + the host_permission in
// manifest.json is what makes that work). If you're not logged in, the API
// calls below will come back 401 and the panel will just tell you so.

const API_BASE = 'https://stagepay.pages.dev';
const STAGES = [
  { stage: 1, label: 'Brief' },
  { stage: 2, label: 'Story' },
  { stage: 3, label: 'Visual & Music' },
  { stage: 4, label: 'Scenes' },
  { stage: 5, label: 'Final Movie' },
];

let currentProjectId = null;
let currentItems = [];
let selectedStage = 2;
let lastCopied = null; // { kind: 'prompt' | 'image', label, preview, copiedAt } — the single most recent copy, not a history

const statusEl = document.getElementById('projectStatus');
const stageTabsEl = document.getElementById('stageTabs');
const itemListEl = document.getElementById('itemList');
const lastCopiedSectionEl = document.getElementById('lastCopiedSection');
const lastCopiedContentEl = document.getElementById('lastCopiedContent');

// One clipboard, one thing on it at a time — a growing history here would
// itself be confusing ("which of these is actually still on my clipboard?").
// This always reflects the single most recent copy, which is exactly what a
// real Ctrl+V would paste right now.
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
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) refreshFromActiveTab();
  });
  chrome.tabs.onActivated.addListener(() => refreshFromActiveTab());
  document.getElementById('refreshBtn').addEventListener('click', () => refreshFromActiveTab());
}

async function refreshFromActiveTab() {
  const projectId = await detectOpenProjectId();
  if (!projectId) {
    statusEl.textContent = 'No StagePay project tab found — open a project at stagepay.pages.dev, then reopen this panel.';
    statusEl.className = 'status error';
    return;
  }
  if (projectId === currentProjectId) return; // already showing this one
  currentProjectId = projectId;
  await loadProject();
  renderStageTabs();
  renderItems();
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

async function loadProject() {
  const r = await fetch(`${API_BASE}/api/projects/${currentProjectId}`, { credentials: 'include' });
  if (r.status === 401) {
    statusEl.textContent = 'Not logged in — log into StagePay in a normal tab first, then reopen this panel.';
    statusEl.className = 'status error';
    currentItems = [];
    return;
  }
  if (!r.ok) {
    statusEl.textContent = `Could not load project (${r.status}).`;
    statusEl.className = 'status error';
    currentItems = [];
    return;
  }
  const data = await r.json();
  currentItems = data.items || [];
  statusEl.textContent = `Connected — ${data.project?.name || 'this project'}`;
  statusEl.className = 'status ok';
  stageTabsEl.hidden = false;
}

function renderStageTabs() {
  stageTabsEl.innerHTML = STAGES.map(
    (s) => `<button data-stage="${s.stage}" class="${s.stage === selectedStage ? 'active' : ''}">${s.stage}. ${s.label}</button>`
  ).join('');
  stageTabsEl.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedStage = Number(btn.getAttribute('data-stage'));
      renderStageTabs();
      renderItems();
    });
  });
}

function theVersion(item) {
  return (item.versions && item.versions[0]) || { prompt: '', media_files: [] };
}

function renderItems() {
  const items = currentItems.filter((i) => i.stage === selectedStage);
  if (!items.length) {
    itemListEl.innerHTML = `<p class="empty-note">No items yet in this stage.</p>`;
    return;
  }
  itemListEl.innerHTML = items
    .map(
      (item) => `
    <div class="item-card" data-item-id="${item.id}">
      <h3>${escapeHtml(item.name || item.item_key)}</h3>
      <textarea readonly>${escapeHtml(theVersion(item).prompt || '')}</textarea>
      <div class="row">
        <button data-copy-prompt="${item.id}">📋 Copy prompt</button>
      </div>
      <div class="thumb-row" data-thumbs="${item.id}"></div>
      <div class="dropzone" data-dropzone="${item.id}">Drag a generated file here, or click to choose one</div>
      <input type="file" accept="image/*,video/*" style="display:none" data-file-input="${item.id}">
    </div>`
    )
    .join('');

  items.forEach((item) => {
    loadThumbs(item);
    wireItemCard(item);
  });
}

async function loadThumbs(item) {
  const row = document.querySelector(`[data-thumbs="${item.id}"]`);
  if (!row) return;
  const files = theVersion(item).media_files || [];
  for (const f of files) {
    try {
      const mediaUrl = `${API_BASE}/api/media/${f.key}`;
      const r = await fetch(mediaUrl, { credentials: 'include' });
      if (!r.ok) continue;
      const blob = await r.blob();
      if (!blob.type.startsWith('image/')) continue; // video thumbs skipped for this sketch

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
      const wrap = document.createElement('div');
      wrap.className = 'thumb-wrap';
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
          console.error('[StagePay Companion] clipboard copy failed', e);
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
  const copyBtn = document.querySelector(`[data-copy-prompt="${item.id}"]`);
  if (copyBtn) copyBtn.addEventListener('click', () => {
    const prompt = theVersion(item).prompt || '';
    navigator.clipboard.writeText(prompt);
    setLastCopied({ kind: 'prompt', label: item.name || item.item_key, preview: prompt });
    copyBtn.textContent = '✓ Copied';
    setTimeout(() => { copyBtn.textContent = '📋 Copy prompt'; }, 1200);
  });

  const dz = document.querySelector(`[data-dropzone="${item.id}"]`);
  const fileInput = document.querySelector(`[data-file-input="${item.id}"]`);
  if (!dz || !fileInput) return;

  dz.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) uploadToItem(item.id, fileInput.files[0]);
  });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) uploadToItem(item.id, file);
  });
}

// Mirrors StagePay's own upload flow exactly: POST the bytes to /api/media,
// then PATCH the item's version with the returned {key, fileName} appended
// to its media_files — same two calls the web app's own upload button makes.
async function uploadToItem(itemId, file) {
  const dz = document.querySelector(`[data-dropzone="${itemId}"]`);
  if (dz) dz.textContent = 'Uploading…';
  try {
    const uploadRes = await fetch(
      `${API_BASE}/api/media?projectId=${encodeURIComponent(currentProjectId)}&fileName=${encodeURIComponent(file.name)}`,
      { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }
    );
    const uploaded = await uploadRes.json();
    if (!uploaded.key) throw new Error('upload_failed');

    const item = currentItems.find((i) => i.id === itemId);
    const kind = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'image';
    const mediaFiles = [...(theVersion(item).media_files || []), { key: uploaded.key, fileName: file.name, kind }];

    await fetch(`${API_BASE}/api/items/${itemId}/version`, {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mediaFiles }),
    });

    theVersion(item).media_files = mediaFiles;
    if (dz) dz.textContent = '✓ Uploaded — visible in StagePay now';
    setTimeout(() => renderItems(), 900);
  } catch (e) {
    if (dz) dz.textContent = 'Upload failed — try again';
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

init();

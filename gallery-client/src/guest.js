import "./guest.css";
import { createGalleryApi, GalleryQueue } from "./queue.js";
import { createGuestSession } from "./guest-session.js";

const root = document.querySelector("#gallery-app");
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
const base = root.dataset.apiBase || (local ? "http://127.0.0.1:5999/v1" : "https://wpvlhc-aog-2026.web.app/v1");
const api = createGalleryApi({ base });
let policy, queue, verification = "", widget;
const session = createGuestSession({ api, getVerification: () => verification });
async function getSessionToken(options) {
  try { return await session(options); }
  catch (error) {
    verification = "";
    if (widget !== undefined) window.turnstile?.reset(widget);
    throw error;
  }
}
const make = (tag, text, className) => { const element = document.createElement(tag); if (text) element.textContent = text; if (className) element.className = className; return element; };
root.append(make("p", "WPVLHC · ASSEMBLY OF GOD", "eyebrow"), make("h1", "Share the evening."), make("p", "A room full of memories. Add yours to the Christmas Gala.", "intro"));
const controls = make("section", "", "share-card"), actions = make("div", "", "choose-actions");
const camera = make("input"), picker = make("input");
for (const input of [camera, picker]) { input.type = "file"; input.accept = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"; input.hidden = true; }
camera.setAttribute("capture", "environment"); picker.multiple = true;
const cameraButton = make("button", "Take a photo"), chooseButton = make("button", "Choose photos", "secondary");
cameraButton.disabled = true; chooseButton.disabled = true;
cameraButton.onclick = () => camera.click(); chooseButton.onclick = () => picker.click();
actions.append(cameraButton, chooseButton, camera, picker);
const progress = make("p", "Opening photo sharing…", "status"); progress.role = "status"; progress.setAttribute("aria-live", "polite");
const selected = make("ul", "", "selection");
const notice = make("p", "Photos will appear publicly after upload. Management may hide them. Originals stay on your device.", "small");
const challenge = make("div"), share = make("button", "Share photos"), retry = make("button", "Retry failed photos", "secondary"), pause = make("button", "Pause", "secondary");
share.disabled = true;
const buttonRow = make("div", "", "choose-actions"); buttonRow.append(share, pause, retry);
controls.append(actions, selected, notice, challenge, buttonRow, progress, make("p", "Keep this page open while sharing. If your connection drops, retry just the unfinished photos.", "small")); root.append(controls);
const gallery = make("section", "", "gallery-section"), heading = make("div", "", "gallery-heading"), refresh = make("button", "Refresh photos", "secondary");
heading.append(make("h2", "From the evening"), refresh);
const grid = make("div", "", "photo-grid"), more = make("button", "Load more photos", "secondary"); more.hidden = true;
gallery.append(heading, grid, more); root.append(gallery);
const viewer = document.createElement("dialog"), close = make("button", "Close photo", "secondary"), full = make("img"); full.alt = "A photo from the Christmas Gala";
viewer.append(close, full); close.onclick = () => { viewer.close(); full.removeAttribute("src"); }; root.append(viewer);
let nextCursor = null;
const known = new Set();
function appendPhoto(photo, first = false) {
  if (known.has(photo.id)) return; known.add(photo.id);
  const button = make("button", "", "photo"), img = make("img"); img.src = photo.thumbnailUrl; img.alt = "Christmas Gala photo"; img.loading = "lazy"; img.width = photo.width; img.height = photo.height;
  button.append(img); button.setAttribute("aria-label", "Open photo");
  button.onclick = async () => {
    button.disabled = true;
    try { photo = await api(`/gallery/photos/${photo.id}`); full.src = photo.displayUrl; viewer.showModal(); }
    catch (error) { progress.textContent = error.message; if (error.status === 404) { button.remove(); known.delete(photo.id); } }
    finally { button.disabled = false; }
  };
  let lastRefresh = 0;
  img.onerror = async () => {
    if (Date.now() - lastRefresh < 60_000) { button.title = "Photo sharing is temporarily unavailable. Please retry shortly."; return; }
    lastRefresh = Date.now();
    try { photo = await api(`/gallery/photos/${photo.id}`); img.src = photo.thumbnailUrl; }
    catch (error) { button.title = error.message; if (error.status === 404) { button.remove(); known.delete(photo.id); } }
  };
  if (first) grid.prepend(button); else grid.append(button);
}
async function load(reset = false) {
  refresh.disabled = true; more.disabled = true;
  try {
    const result = await api(`/gallery/photos?limit=20${!reset && nextCursor ? `&after=${nextCursor}` : ""}`);
    if (reset) { grid.replaceChildren(); known.clear(); }
    result.photos.forEach(photo => appendPhoto(photo)); nextCursor = result.nextCursor; more.hidden = !nextCursor;
    if (!known.size) grid.append(make("p", "The first memories will appear here soon.", "small empty-gallery"));
  } catch (error) { progress.textContent = error.message; }
  finally { refresh.disabled = false; more.disabled = false; }
}
refresh.onclick = () => load(true); more.onclick = () => load();
const phases = { queued: "Ready to share", preparing: "Preparing on your device…", authorizing: "Preparing upload…", uploading: "Uploading…", publishing: "Adding to gallery…", retrying: "Connection interrupted — retrying…", published: "In the gallery", pending: "Uploaded — awaiting approval", failed: "Needs a retry", reselect: "Choose this source photo again to resume" };
const previews = new Map();
function render(rows, state) {
  const done = rows.filter(row => ["published", "pending"].includes(row.phase)).length, failures = rows.filter(row => row.phase === "failed").length;
  selected.replaceChildren();
  for (const row of rows.slice(-20)) {
    const item = make("li"), label = make("div"); label.append(make("strong", row.fileName), make("span", row.error || phases[row.phase] || row.phase, row.phase === "failed" ? "error" : "small"));
    if (row.prepared) {
      if (!previews.has(row.itemId)) previews.set(row.itemId, URL.createObjectURL(row.prepared.thumbnail.blob));
      const img = make("img"); img.src = previews.get(row.itemId); img.alt = "Selected photo preview"; img.width = 64; img.height = 64; item.append(img);
    }
    item.append(label);
    if (!state.running && row.phase === "queued") { const remove = make("button", "Remove", "text-button"); remove.onclick = () => state.remove(row.itemId); item.append(remove); }
    selected.append(item);
    if (row.photo) { grid.querySelector(".empty-gallery")?.remove(); appendPhoto(row.photo, true); }
  }
  for (const [id, url] of previews) if (!rows.some(row => row.itemId === id && row.prepared)) { URL.revokeObjectURL(url); previews.delete(id); }
  share.disabled = state.running || state.preparing || !rows.some(row => row.phase === "queued") || !policy?.guestUploadsOpen;
  share.textContent = state.running ? "Sharing…" : "Share photos";
  pause.hidden = !state.running; pause.textContent = state.paused ? "Resume" : "Pause";
  retry.hidden = !failures || state.running;
  if (rows.length) progress.textContent = state.error || `${done} of ${rows.length} shared${failures ? ` · ${failures} need a retry` : ""}${state.storageWarning ? ` · ${state.storageWarning}` : ""}`;
}
for (const input of [camera, picker]) input.onchange = async () => {
  if (input.files.length > 20) { progress.textContent = "Choose up to 20 photos at a time."; input.value = ""; return; }
  if (queue) { queue.add([...input.files]); input.value = ""; await queue.preparePreviews(); }
};
share.onclick = () => queue.start();
retry.onclick = () => queue.retryFailed(); pause.onclick = () => queue.paused ? queue.start() : queue.pause();
window.addEventListener("beforeunload", event => { if (queue?.running) { event.preventDefault(); event.returnValue = ""; } });
try {
  policy = await api("/gallery/policy");
  queue = new GalleryQueue({ api, getSessionToken, storageKey: `guest:${base}`, onChange: render }); await queue.restore();
  if (policy.requireApproval) notice.textContent = "Photos will appear publicly after management approval. Originals stay on your device.";
  if (!policy.guestUploadsOpen) { cameraButton.disabled = true; chooseButton.disabled = true; progress.textContent = "Guest photo sharing is closed. You can still enjoy the gallery."; }
  else { cameraButton.disabled = false; chooseButton.disabled = false; progress.textContent = "Take a photo or choose a few favourites to get started."; }
  if (policy.turnstileSiteKey) {
    const script = document.createElement("script"); script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; script.async = true;
    script.onload = () => { widget = window.turnstile.render(challenge, { sitekey: policy.turnstileSiteKey, action: "gallery-upload", callback: token => { verification = token; }, "expired-callback": () => { verification = ""; } }); };
    script.onerror = () => { progress.textContent = "Photo-sharing verification could not load. Please check your connection and refresh."; };
    document.head.append(script);
  }
  await load(true);
} catch (error) { progress.textContent = error.message; share.disabled = true; cameraButton.disabled = true; chooseButton.disabled = true; }

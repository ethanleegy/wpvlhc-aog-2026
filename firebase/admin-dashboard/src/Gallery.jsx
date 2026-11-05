import { useEffect, useRef, useState } from "react";
import { createGalleryApi, GalleryQueue } from "../../../gallery-client/src/queue.js";
import { galleryQr } from "../../../gallery-client/src/qr.js";

const api = createGalleryApi({ admin: true });
const mb = bytes => (bytes || 0) < 1_000_000 ? `${((bytes || 0) / 1000).toFixed(1)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
const phaseLabel = { queued: "Ready", preparing: "Preparing on your device", authorizing: "Preparing upload", uploading: "Uploading", publishing: "Adding to gallery", retrying: "Retrying", published: "Visible", pending: "Awaiting approval", failed: "Needs attention", reselect: "Select source photo again" };

export default function Gallery() {
  const [settings, setSettings] = useState(null), [photos, setPhotos] = useState([]);
  const [filter, setFilter] = useState("all"), [batch, setBatch] = useState("");
  const [cursor, setCursor] = useState(null), [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]), [queueState, setQueueState] = useState({});
  const [publication, setPublication] = useState("follow"), [qr, setQr] = useState("");
  const [preview, setPreview] = useState(null);
  const queue = useRef(null), picker = useRef(null), alive = useRef(true);
  const thumbnailRefreshes = useRef(new Map());
  async function refreshThumbnail(photo) {
    const previous = thumbnailRefreshes.current.get(photo.id);
    if (previous !== undefined && Date.now() - previous < 60_000) return;
    thumbnailRefreshes.current.set(photo.id, Date.now());
    try {
      const latest = await api(`/gallery/photos/${photo.id}`);
      if (alive.current) setPhotos(current => current.map(item => item.id === photo.id ? { ...item, thumbnailUrl: latest.thumbnailUrl } : item));
    } catch (failure) { if (alive.current) setError(failure.message); }
  }
  async function load(append = false) {
    setBusy(true); setError("");
    try {
      const [current, result] = await Promise.all([
        api("/gallery/settings"),
        api(`/gallery/photos?status=${filter}&limit=20${batch ? `&batchId=${encodeURIComponent(batch)}` : ""}${append && cursor ? `&after=${cursor}` : ""}`),
      ]);
      if (!alive.current) return;
      setSettings(current); setPhotos(old => append ? [...old, ...result.photos] : result.photos);
      setCursor(result.nextCursor); if (!append) setSelected(new Set());
    } catch (failure) { if (alive.current) setError(failure.message); }
    finally { if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true;
    const instance = new GalleryQueue({ api, admin: true, storageKey: "admin:gallery-v1", onChange: (items, state) => {
      if (alive.current) { setRows([...items]); setQueueState({ running: state.running, paused: state.paused, error: state.error, warning: state.storageWarning, batchId: state.batchId }); }
    } });
    queue.current = instance;
    instance.restore().then(() => { if (alive.current) setPublication(instance.publication); });
    const leaving = event => { if (instance.running) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leaving);
    return () => { alive.current = false; instance.pause(); window.removeEventListener("beforeunload", leaving); };
  }, []);
  useEffect(() => { load(); }, [filter, batch]);
  useEffect(() => {
    let cancelled = false;
    if (settings?.uploadUrl) galleryQr(settings.uploadUrl).then(value => { if (!cancelled) setQr(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [settings?.uploadUrl]);
  async function perform(work) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function changeSetting(name, value) {
    const previous = settings;
    setSettings({ ...previous, [name]: value });
    await perform(async () => {
      try { setSettings(await api("/gallery/settings", { [name]: value }, "PATCH")); }
      catch (failure) { setSettings(previous); throw failure; }
    });
  }
  async function moderate(action) {
    await perform(async () => {
      const ids = [...selected], failures = [];
      for (let index = 0; index < ids.length; index += 25) {
        const result = await api("/gallery/actions", { action, photoIds: ids.slice(index, index + 25) });
        failures.push(...result.results.filter(item => !item.success));
      }
      await load(); setSelected(new Set(failures.map(item => item.id)));
      setNotice(`${ids.length - failures.length} photo${ids.length === 1 ? "" : "s"} ${action === "show" ? "shown" : "hidden"}${failures.length ? `; ${failures.length} need a retry` : "."}`);
    });
  }
  async function start(retry = false) {
    queue.current.publication = publication;
    await (retry ? queue.current.retryFailed() : queue.current.start());
    await load();
  }
  function newBatch() {
    const instance = queue.current;
    instance.clearFinished(); instance.batchId = undefined; instance.batchRequest = undefined; instance.error = null; instance.changed();
  }
  const finished = rows.filter(row => ["published", "pending"].includes(row.phase)).length;
  const failed = rows.filter(row => row.phase === "failed").length;
  const sourceBytes = rows.reduce((sum, row) => sum + row.sourceBytes, 0), outputBytes = rows.reduce((sum, row) => sum + (row.compressedBytes || 0), 0);
  const toggle = id => setSelected(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  return <section className="gallery-management">
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!settings ? <p className="muted">{busy ? "Opening photo management…" : "Photo management is not enabled. Start the local gallery or enable it after the account review."}</p> : <>
      <div className="gallery-settings panel">
        <div><h2>Share the evening</h2><p className="muted">Photos appear automatically unless you turn on prior approval. Hide or show them at any time.</p>
          <label className="gallery-toggle"><input type="checkbox" checked={settings.requireApproval} disabled={busy} onChange={e => changeSetting("requireApproval", e.target.checked)} />Require approval before display</label>
          <label className="gallery-toggle"><input type="checkbox" checked={settings.guestUploadsOpen} disabled={busy} onChange={e => changeSetting("guestUploadsOpen", e.target.checked)} />Guest photo sharing open</label>
          <label className="gallery-toggle"><input type="checkbox" checked={settings.adminUploadsOpen} disabled={busy} onChange={e => changeSetting("adminUploadsOpen", e.target.checked)} />Admin uploads open</label>
          <p className="small muted">Reserved storage: {mb(settings.capacity.reservedBytes)} of {mb(settings.limits.storageBytes)} · {settings.capacity.photoCount} photos. Free allowance review due {new Date(settings.billingEnd).toLocaleDateString()}.</p>
        </div>
        <div className="gallery-qr">{qr && <><img src={qr} width="180" height="180" alt="QR code for guest photo sharing" /><a className="quiet" href={qr} download="gala-photo-sharing-qr.png">Download QR</a></>}<a href={settings.uploadUrl} target="_blank" rel="noreferrer">Open guest sharing ↗</a></div>
      </div>
      <section className="panel gallery-upload"><h2>Add your photos</h2><p className="muted">Select your collection. Photos are compressed on this device and uploaded a few at a time. Keep this page open.</p>
        <div className="gallery-controls">
          <label>Publish this batch<select aria-label="Publish this batch" value={publication} disabled={queueState.running || Boolean(queueState.batchId)} onChange={e => setPublication(e.target.value)}><option value="follow">Follow gallery setting</option><option value="publish">Publish after upload</option><option value="review">Keep private for review</option></select></label>
          <input ref={picker} type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Choose admin photos" onChange={e => { queue.current.add([...e.target.files]); e.target.value = ""; }} />
          <button disabled={queueState.running || !settings.adminUploadsOpen || !rows.some(row => row.phase === "queued")} onClick={() => start()}>Start sharing</button>
          {queueState.running && <button className="secondary" onClick={() => queueState.paused ? queue.current.start() : queue.current.pause()}>{queueState.paused ? "Resume" : "Pause"}</button>}
          {!!failed && !queueState.running && <button className="secondary" onClick={() => start(true)}>Retry failed photos</button>}
          {!queueState.running && rows.length > 0 && rows.every(row => ["published", "pending"].includes(row.phase)) && <button className="secondary" onClick={newBatch}>New batch</button>}
        </div>
        {rows.length > 0 && <><p role="status">{finished} of {rows.length} shared · {failed} need attention · Selected {mb(sourceBytes)} · Prepared {mb(outputBytes)}</p><progress max={rows.length} value={finished} aria-label="Photo upload progress" />
          <ul className="gallery-queue">{rows.filter(row => !["published", "pending"].includes(row.phase)).slice(0, 25).map(row => <li key={row.itemId}><strong>{row.fileName}</strong><span className={row.error ? "error" : "muted"}>{row.error || phaseLabel[row.phase]}</span>{!queueState.running && <button className="quiet" onClick={() => queue.current.remove(row.itemId)}>Remove</button>}</li>)}</ul>
          {rows.length - finished > 25 && <p className="small muted">Showing the next 25 unfinished photos. The full batch stays in the queue.</p>}</>}
        {(queueState.error || queueState.warning) && <p className="error" role="alert">{queueState.error || queueState.warning}</p>}
      </section>
      <div className="gallery-controls gallery-review-controls">
        <label>Show photos<select aria-label="Show photos" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All submissions</option><option value="visible">Visible</option><option value="hidden">Hidden</option><option value="pending">Awaiting approval</option><option value="failed">Failed validation</option></select></label>
        <button className="secondary" disabled={busy} onClick={() => load()}>Refresh photos</button>
        {queueState.batchId && <button className="quiet" onClick={() => setBatch(batch ? "" : queueState.batchId)}>{batch ? "Show all batches" : "Show this upload batch"}</button>}
        <button className="quiet" disabled={busy || !photos.length} onClick={() => setSelected(new Set(photos.map(photo => photo.id)))}>Select loaded photos ({photos.length})</button>
        <button disabled={busy || !selected.size} onClick={() => moderate("hide")}>Hide selected ({selected.size})</button>
        <button className="secondary" disabled={busy || !selected.size} onClick={() => moderate("show")}>Show selected ({selected.size})</button>
        <button className="quiet" disabled={busy} onClick={() => perform(async () => { const result = await api("/gallery/maintenance", { limit: 10 }); await load(); setNotice(`${result.repaired} operations repaired; ${result.cleaned} uploads cleaned.`); })}>Retry pending operations</button>
      </div>
      <div className="gallery-review-grid">{photos.map(photo => <article className="gallery-photo-card" key={photo.id}>
        <label className="gallery-selection"><input type="checkbox" checked={selected.has(photo.id)} onChange={() => toggle(photo.id)} />Select {photo.fileName}</label>
        {photo.thumbnailUrl ? <button className="gallery-photo-preview" onClick={() => perform(async () => setPreview(await api(`/gallery/photos/${photo.id}`)))} aria-label={`Preview ${photo.fileName}`}><img src={photo.thumbnailUrl} loading="lazy" alt={photo.fileName} onError={() => refreshThumbnail(photo)} /></button> : <div className="gallery-photo-placeholder">{photo.uploadState}</div>}
        <p><strong>{photo.fileName}</strong><br /><span className="small muted">{photo.desiredVisible ? (photo.deliveryState === "published" ? "Visible" : "Publishing") : photo.reviewState === "pending" ? "Awaiting approval" : "Hidden"} · {photo.source === "admin" ? "Admin" : "Guest"}</span></p>
        {photo.error && <p className="error">{photo.error.replaceAll("_", " ").toLowerCase()}</p>}
      </article>)}</div>
      {!photos.length && <p className="muted">No photos in this view yet.</p>}
      {cursor && <button className="secondary" disabled={busy} onClick={() => load(true)}>Load more photos</button>}
    </>}
    {preview && <div className="gallery-lightbox" role="dialog" aria-modal="true" aria-label="Photo preview"><button className="secondary" onClick={() => setPreview(null)}>Close photo</button><img src={preview.displayUrl} alt={preview.fileName} /></div>}
  </section>;
}

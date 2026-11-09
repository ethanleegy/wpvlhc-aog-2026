import { useState, useRef } from "react";
import { api, downloadCsv } from "./api.js";
import { parseFoodCsv, foodImportBatches, MAX_CSV_BYTES } from "./food-csv.js";

const storageKey = "wpvlhc-food-import-v1";
function restoreImport() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved?.batches?.length && Number.isInteger(saved.next) && saved.next >= 0 && saved.next < saved.batches.length && saved.batches.every((batch) => typeof batch.requestId === "string" && Array.isArray(batch.items) && batch.items.length > 0 && batch.items.length <= 10)) return saved;
  } catch { /* A new import can still be prepared if stored data is unavailable. */ }
  return null;
}

export function FoodImport({ Modal, onClose, onRefresh }) {
  const [plan, setPlan] = useState(restoreImport);
  const current = useRef(plan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [discard, setDiscard] = useState(false);
  function remember(next) {
    // Save before writes so reloads and retries reuse the original request IDs.
    try { localStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { throw new Error("This browser could not save import progress. Allow site storage or use a smaller CSV."); }
    current.current = next; setPlan(next);
  }
  async function choose(event) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setError(""); setBusy(true);
    try {
      if (file.size > MAX_CSV_BYTES) throw new Error("Choose a CSV smaller than 8 MB.");
      const items = parseFoodCsv(await file.text());
      const batches = foodImportBatches(items);
      remember({ batches, next: 0, fileName: file.name });
      setDone(false); setDiscard(false);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function run() {
    if (busy || !current.current) return;
    setBusy(true); setError("");
    try {
      while (current.current.next < current.current.batches.length) {
        const saved = current.current;
        await api("/food-items/import", { method: "POST", body: saved.batches[saved.next] });
        remember({ ...saved, next: saved.next + 1 });
      }
      localStorage.removeItem(storageKey); setDone(true);
    } catch (failure) { setError(`${failure.message} You can retry or reopen this import to continue.`); }
    finally { setBusy(false); await onRefresh(); }
  }
  const items = plan?.batches.flatMap((batch) => batch.items) || [];
  const completed = plan?.batches.slice(0, plan.next).reduce((count, batch) => count + batch.items.length, 0) || 0;
  function reset() {
    localStorage.removeItem(storageKey); current.current = null; setPlan(null); setDiscard(false); setError(""); setDone(false);
  }
  return (
    <Modal labelledBy="food-import-title" wide busy={busy} onClose={onClose}>
      <div className="section-head"><h2 id="food-import-title">Import food items from CSV</h2><button className="quiet" disabled={busy} onClick={onClose}>Close</button></div>
      <p className="muted">One row creates one new food slot. Repeated names create separate slots. Existing items and guest selections stay as they are.</p>
      <button className="secondary" disabled={busy} onClick={() => downloadCsv("gala-food-template.csv", ["Name", "Unit", "Description", "Active"], [["Baked chicken", "servings", "Bring cooked", "true"], ["Fruit juice", "bottles", "Chilled", "true"]])}>Download CSV template ↓</button>
      {!plan || done ? <label>Choose food CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={choose} /></label> : (
        <>
          <p>{plan.fileName} · {items.length} food items</p>
          <p role="status">{completed} of {items.length} added{done ? ". Import complete." : ". Progress is saved on this browser."}</p>
          <div className="table-scroll"><table><thead><tr><th>#</th><th>Name</th><th>Unit</th><th>Description</th><th>Active</th></tr></thead><tbody>
            {items.slice(0, 10).map((item, index) => <tr key={index}><td>{index + 1}</td><td>{item.name}</td><td>{item.unit}</td><td>{item.description || "—"}</td><td>{item.active ? "Yes" : "No"}</td></tr>)}
          </tbody></table></div>
          {items.length > 10 && <p className="muted">Showing the first 10 rows. All {items.length} rows passed validation.</p>}
          <p className="muted">You can close and reopen this window to resume. Importing the same CSV as a new import will create new slots.</p>
          {discard ? <div className="notice"><p>{completed} items are already added and will remain. Discard the remaining import plan to choose another file?</p><button className="secondary" disabled={busy} onClick={reset}>Confirm discard</button><button className="quiet" disabled={busy} onClick={() => setDiscard(false)}>Keep import</button></div> : <button className="quiet" disabled={busy} onClick={() => completed ? setDiscard(true) : reset()}>Choose another CSV</button>}
        </>
      )}
      {done && <p className="notice" role="status">All {completed} food items added.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions"><button disabled={busy || !plan} onClick={done ? onClose : run}>{busy ? "Importing…" : done ? "Done" : completed ? "Continue import" : "Add food items"}</button></div>
    </Modal>
  );
}

export function FoodDelete({ Modal, foods, onClose, onRefresh, onDeleted }) {
  const [requiresWord, setRequiresWord] = useState(foods.some((food) => food.claimedBy || food.hasContributions));
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = useRef(0);
  const [completed, setCompleted] = useState(0);
  async function remove(event) {
    event.preventDefault();
    if (busy || (requiresWord && word !== "delete")) return;
    setBusy(true); setError("");
    try {
      while (next.current < foods.length) {
        const chunk = foods.slice(next.current, next.current + 50);
        const body = { ...(requiresWord ? { confirmation: "delete" } : {}) };
        if (foods.length === 1) await api(`/food-items/${foods[0].id}`, { method: "DELETE", body });
        else await api("/food-items/bulk-delete", { method: "POST", body: { ...body, ids: chunk.map((food) => food.id) } });
        next.current += chunk.length; setCompleted(next.current); onDeleted(chunk.map((food) => food.id));
      }
      onClose();
    } catch (failure) {
      if (failure.code === "FOOD_DELETE_CONFIRMATION_REQUIRED") setRequiresWord(true);
      setError(failure.message);
    } finally { setBusy(false); await onRefresh(); }
  }
  return (
    <Modal labelledBy="food-delete-title" busy={busy} onClose={onClose}>
      <form onSubmit={remove}>
        <div className="section-head"><h2 id="food-delete-title">Delete {foods.length === 1 ? "food item" : `${foods.length} food items`}?</h2><button className="quiet" type="button" disabled={busy} onClick={onClose}>Cancel</button></div>
        {requiresWord ? <div className="delete-warning" role="alert"><h3>Guest selections will be removed</h3><p>These items are selected or have contribution history. Deleting them also removes their choices from affected guests, reports and food totals. Guests keep their attendance and other food choices.</p><strong>This cannot be undone.</strong></div> : <p>The selected food items will be permanently removed. This cannot be undone.</p>}
        <ul className="delete-items">{foods.slice(0, 10).map((food) => <li key={food.id}>{food.name} · {food.unit}</li>)}</ul>
        {foods.length > 10 && <p className="muted">And {foods.length - 10} more selected items.</p>}
        {requiresWord && <label>Type delete to confirm<input autoComplete="off" spellCheck="false" value={word} onChange={(event) => setWord(event.target.value)} required /></label>}
        {completed > 0 && <p role="status">{completed} of {foods.length} deleted. Retry continues with the remaining items.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions"><button className="destructive" disabled={busy || (requiresWord && word !== "delete")}>{busy ? "Deleting…" : completed ? "Retry deletion" : foods.length === 1 ? "Delete item" : "Delete selected items"}</button></div>
      </form>
    </Modal>
  );
}

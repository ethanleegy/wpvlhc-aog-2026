import { useRef, useState } from "react";
import { api } from "./api.js";

export function PeopleDelete({ Modal, people, onClose, onRefresh, onDeleted }) {
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = useRef(0);
  const [completed, setCompleted] = useState(0);
  async function remove(event) {
    event.preventDefault();
    if (busy || word !== "delete") return;
    setBusy(true); setError("");
    try {
      while (next.current < people.length) {
        // Each person can hold 30 food slots; small groups keep cleanup bounded.
        const chunk = people.slice(next.current, next.current + 10);
        const body = { confirmation: "delete" };
        if (people.length === 1) await api(`/guests/${people[0].id}`, { method: "DELETE", body });
        else await api("/guests/bulk-delete", { method: "POST", body: { ...body, ids: chunk.map((person) => person.id) } });
        next.current += chunk.length; setCompleted(next.current);
        onDeleted(chunk.map((person) => person.id));
      }
      onClose();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); await onRefresh(); }
  }
  return (
    <Modal labelledBy="people-delete-title" busy={busy} onClose={onClose}>
      <form onSubmit={remove}>
        <div className="section-head">
          <h2 id="people-delete-title">Delete {people.length === 1 ? "person" : `${people.length} people`}?</h2>
          <button className="quiet" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        </div>
        <div className="delete-warning" role="alert">
          <h3>Registrations will be permanently removed</h3>
          <p>This removes the selected people, their plus-ones and food contributions. Their invitation links stop working, and their food slots are released for others to choose.</p>
          <strong>This cannot be undone.</strong>
        </div>
        <ul className="delete-items">{people.slice(0, 10).map((person) => <li key={person.id}>{person.name}{person.plusOne && person.plusOneName ? ` + ${person.plusOneName}` : ""}</li>)}</ul>
        {people.length > 10 && <p className="muted">And {people.length - 10} more selected people.</p>}
        <label>Type delete to confirm<input autoComplete="off" spellCheck="false" value={word} onChange={(event) => setWord(event.target.value)} required /></label>
        {completed > 0 && <p role="status">{completed} of {people.length} deleted. Retry continues with the remaining people.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions"><button className="destructive" disabled={busy || word !== "delete"}>{busy ? "Deleting…" : completed ? "Retry deletion" : people.length === 1 ? "Delete person" : "Delete selected people"}</button></div>
      </form>
    </Modal>
  );
}

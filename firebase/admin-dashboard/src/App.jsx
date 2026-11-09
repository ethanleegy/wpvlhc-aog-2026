import { Children, cloneElement, useEffect, useRef, useState } from "react";
import { allGuests, api, downloadCsv } from "./api.js";
import Gallery from "./Gallery.jsx";
import { FoodImport, FoodDelete } from "./FoodOperations.jsx";
import { PeopleDelete } from "./PeopleOperations.jsx";

const churchId = "wpvlhc-aog";
const churchName = "World Prayer Vision Life Healing Center · AOG";
const tabs = [
  ["overview", "Overview"],
  ["guests", "People"],
  ["food", "Food & drinks"],
  ["churches", "Church settings"],
  ["contributions", "Who is bringing what"],
  ["gallery", "Photo gallery"],
];
const statusText = {
  yes: "Attending",
  no: "Declined",
  pending: "Awaiting reply",
};
function Status({ value }) {
  return <span className={`badge ${value}`}>{statusText[value] || value}</span>;
}
function Empty({ children }) {
  return <p className="empty">{children}</p>;
}
function Table({ headers, children }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col" className="row-number">#</th>
            {headers.map((label) => (
              <th scope="col" key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Children.toArray(children).map((row, index) => cloneElement(row, {}, [
            <th scope="row" className="row-number" key="row-number">{index + 1}</th>,
            ...Children.toArray(row.props.children),
          ]))}
        </tbody>
      </table>
    </div>
  );
}

function Modal({ labelledBy, wide = false, busy, onClose, children }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal${wide ? " wide" : ""}`}
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

function Login({ onLogin }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    setShowPassword(false);
    const form = new FormData(event.currentTarget);
    try {
      onLogin(
        await api("/login", {
          method: "POST",
          body: {
            username: form.get("username").trim(),
            password: form.get("password"),
          },
        }),
      );
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-intro">
        <span className="brand-mark">✳</span>
        <p className="eyebrow">World Prayer Vision Life Healing Center · AOG</p>
        <h1>
          A place for
          <br />
          <em>everyone.</em>
        </h1>
        <p>Christmas Gala · December 12, 2026</p>
      </div>
      <form className="login-card" onSubmit={submit}>
        <p className="eyebrow">Church management</p>
        <h2>Welcome back</h2>
        <p className="muted">
          Manage registrations, plan the table, and bring the evening together.
        </p>
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            required
            maxLength={120}
          />
        </label>
        <label htmlFor="admin-password">Password</label>
        <div className="password-field">
          <input
            id="admin-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            maxLength={72}
          />
          <button
            type="button"
            className="password-toggle"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-controls="admin-password"
            aria-pressed={showPassword}
            disabled={busy}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {showPassword && <path d="m3 3 18 18" />}
            </svg>
          </button>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button disabled={busy}>{busy ? "Signing in…" : "Sign in →"}</button>
      </form>
    </main>
  );
}

function RecordEditor({ editor, onClose, onSave }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { kind, record = {} } = editor;
  const guest = kind === "guests";
  const food = kind === "food-items";
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const body = {
      name: form.get("name").trim(),
      active: form.get("active") === "on",
    };
    if (guest)
      Object.assign(body, {
        churchId,
        personalizedName: form.get("personalizedName").trim(),
      });
    if (food)
      Object.assign(body, {
        unit: form.get("unit").trim(),
        description: form.get("description").trim(),
      });
    try {
      await api(`/${kind}${record.id ? `/${record.id}` : ""}`, {
        method: record.id ? "PATCH" : "POST",
        body,
      });
      await onSave();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal labelledBy="editor-title" busy={busy} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="section-head">
          <h2 id="editor-title">
            {record.id ? "Edit" : "Add"}{" "}
            {guest ? "person" : food ? "food item" : "church"}
          </h2>
          <button
            className="quiet"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Close
          </button>
        </div>
        <label>
          Name
          <input
            autoFocus
            name="name"
            required
            maxLength={160}
            defaultValue={record.name || ""}
          />
        </label>
        {guest && (
          <>
            <label>
              Personal greeting
              <input
                name="personalizedName"
                maxLength={160}
                defaultValue={record.personalizedName || ""}
                placeholder="Uses the person's name when blank"
              />
            </label>
            <p className="muted">{churchName}</p>
          </>
        )}
        {food && (
          <>
            <label>
              Unit
              <input
                name="unit"
                required
                maxLength={40}
                defaultValue={record.unit || "servings"}
                readOnly={record.hasContributions}
              />
            </label>
            {record.hasContributions && (
              <small className="muted">
                The unit is fixed because people have already contributed this
                item.
              </small>
            )}
            <label>
              Description
              <textarea
                name="description"
                maxLength={500}
                defaultValue={record.description || ""}
              />
            </label>
          </>
        )}
        <label className="check">
          <input
            name="active"
            type="checkbox"
            defaultChecked={record.active ?? true}
          />{" "}
          Active
        </label>
        <p className="muted">
          {guest
            ? "Inactive invitations cannot be opened and are excluded from reports."
            : food
              ? "Inactive items stay in existing contributions and reports."
              : "Inactive churches keep their invitations and reports; new invitations require an active church."}
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ReplyEditor({ guest, foods, onClose, onSave }) {
  const [rsvp, setRsvp] = useState(
    guest.rsvp === "pending" ? "yes" : guest.rsvp,
  );
  const [items, setItems] = useState(
    guest.items.map(({ foodItemId, quantity, notes }) => ({
      foodItemId,
      quantity,
      notes,
    })),
  );
  const [plusOne, setPlusOne] = useState(guest.plusOne === true);
  const [plusOneName, setPlusOneName] = useState(guest.plusOneName || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function change(id, field, value) {
    setItems((rows) =>
      rows.map((row) =>
        row.foodItemId === id ? { ...row, [field]: value } : row,
      ),
    );
  }
  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api(`/guests/${guest.id}/reply`, {
        method: "POST",
        body: {
          rsvp,
          plusOne: rsvp === "yes" && plusOne,
          plusOneName: rsvp === "yes" && plusOne ? plusOneName.trim() : "",
          items: rsvp === "yes" ? items : [],
        },
      });
      await onSave();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal labelledBy="reply-title" wide busy={busy} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="section-head">
          <h2 id="reply-title">Reply for {guest.name}</h2>
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <label>
          Attendance
          <select
            autoFocus
            value={rsvp}
            onChange={(event) => setRsvp(event.target.value)}
          >
            <option value="yes">Attending</option>
            <option value="no">Declined</option>
          </select>
        </label>
        {rsvp === "yes" && (
          <>
            <label className="check">
              <input type="checkbox" checked={plusOne} onChange={(event) => setPlusOne(event.target.checked)} />
              Bringing a plus-one
            </label>
            {plusOne && (
              <label>
                Plus-one name
                <input required maxLength={160} value={plusOneName} onChange={(event) => setPlusOneName(event.target.value)} />
              </label>
            )}
            <h3>Food contributions</h3>
            {items.map((item) => {
              const food = foods.find((row) => row.id === item.foodItemId);
              return (
                <div className="contribution-row" key={item.foodItemId}>
                  <strong>{food?.name || item.foodItemId}</strong>
                  <label>
                    Quantity ({food?.unit})
                    <input
                      type="number"
                      min="1"
                      max="10000"
                      required
                      value={item.quantity}
                      onChange={(event) =>
                        change(
                          item.foodItemId,
                          "quantity",
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                  <label>
                    Notes
                    <input
                      maxLength={500}
                      value={item.notes}
                      onChange={(event) =>
                        change(item.foodItemId, "notes", event.target.value)
                      }
                    />
                  </label>
                  <button
                    className="quiet danger"
                    type="button"
                    onClick={() =>
                      setItems((rows) =>
                        rows.filter(
                          (row) => row.foodItemId !== item.foodItemId,
                        ),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              );
            })}
            <label>
              Add a food item
              <select
                value=""
                disabled={items.length >= 30}
                onChange={(event) => {
                  if (event.target.value)
                    setItems((rows) => [
                      ...rows,
                      {
                        foodItemId: event.target.value,
                        quantity: 1,
                        notes: "",
                      },
                    ]);
                }}
              >
                <option value="">Choose an item</option>
                {foods
                  .filter(
                    (food) =>
                      food.active &&
                      (!food.claimedBy || food.claimedBy === guest.id) &&
                      !items.some((item) => item.foodItemId === food.id),
                  )
                  .map((food) => (
                    <option key={food.id} value={food.id}>
                      {food.name} · {food.unit}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        {rsvp === "no" && (
          <p className="muted">
            Saving a declined reply removes this person's food contributions.
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button disabled={busy}>{busy ? "Saving…" : "Save reply"}</button>
        </div>
      </form>
    </Modal>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState(null);
  const [reply, setReply] = useState(null);
  const [selectedFoods, setSelectedFoods] = useState(new Set());
  const [foodDeletion, setFoodDeletion] = useState(null);
  const [foodImport, setFoodImport] = useState(false);
  const [selectedPeople, setSelectedPeople] = useState(new Set());
  const [peopleDeletion, setPeopleDeletion] = useState(null);
  useEffect(() => {
    function expired() {
      setUser(null);
      setData(null);
      setEditor(null);
      setReply(null);
      setFoodDeletion(null); setFoodImport(false); setSelectedFoods(new Set());
      setPeopleDeletion(null); setSelectedPeople(new Set());
    }
    window.addEventListener("session-expired", expired);
    api("/session")
      .then(setUser)
      .catch((failure) => {
        if (failure.status !== 401) setError(failure.message);
      })
      .finally(() => setChecking(false));
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  async function load() {
    setBusy(true);
    setError("");
    try {
      const [guests, { churches }, { foodItems }, report] = await Promise.all([
        allGuests(churchId),
        api("/churches"),
        api("/food-items"),
        api(`/reports/summary?churchId=${churchId}`),
      ]);
      setData({ guests, churches, foodItems, report });
      const ids = new Set(foodItems.map((food) => food.id));
      setSelectedFoods((selected) => new Set([...selected].filter((id) => ids.has(id))));
      const guestIds = new Set(guests.map((guest) => guest.id));
      setSelectedPeople((selected) => new Set([...selected].filter((id) => guestIds.has(id))));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (user) load();
  }, [user]);
  useEffect(() => { setSelectedPeople(new Set()); }, [tab]);
  async function perform(action) {
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      setError(failure.message);
    }
  }
  async function saved() {
    setEditor(null);
    setReply(null);
    setNotice("Changes saved.");
    await load();
  }
  async function copy(guest) {
    await navigator.clipboard.writeText(guest.uniqueUrl);
    setNotice(`Invitation link copied for ${guest.name}.`);
  }
  if (checking)
    return (
      <main className="loading" role="status">
        Opening church management…
      </main>
    );
  if (!user)
    return (
      <>
        <Login onLogin={setUser} />
        {error && (
          <p role="alert" className="error login-error">
            {error}
          </p>
        )}
      </>
    );
  const report = data?.report;
  const filteredGuests = (data?.guests || []).filter(
    (guest) =>
      guest.churchId === churchId &&
      (!status || guest.rsvp === status) &&
      `${guest.name} ${guest.personalizedName || ""} ${guest.plusOneName || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const church = data?.churches.find((row) => row.id === churchId);
  const selectedPeopleInView = filteredGuests.filter((guest) => selectedPeople.has(guest.id));
  const contributions = (report?.contributions || []).filter(
    (item) => item.churchId === churchId,
  ).sort((a, b) => a.guestName.localeCompare(b.guestName) || a.foodName.localeCompare(b.foodName) || a.foodItemId.localeCompare(b.foodItemId));
  const totals = report?.totals || {
    invited: 0,
    yes: 0,
    no: 0,
    pending: 0,
    contributors: 0,
    plusOnes: 0,
    attendingPeople: 0,
  };
  const foodRows = report?.foodItems || [];
  const foodById = new Map((data?.foodItems || []).map((food) => [food.id, food]));
  const selectedFoodCount = new Set(contributions.map((item) => item.foodItemId)).size;
  const availableFoodCount = (data?.foodItems || []).filter((food) => food.active && !food.claimedBy).length;
  const attendingPeople = totals.attendingPeople ?? totals.yes + (totals.plusOnes || 0);
  const plusOnes = totals.plusOnes || 0;
  function exportPeople() {
    downloadCsv("gala-people.csv", ["#", "Name", "Plus-one name", "RSVP", "Status", "Invitation URL", "Responded at"],
      filteredGuests.map((guest, index) => [index + 1, guest.name, guest.plusOneName || "", statusText[guest.rsvp], guest.active ? "Active" : "Inactive", guest.uniqueUrl, guest.respondedAt]));
  }
  function foodStatus(food) {
    return food.active ? food.claimedBy ? "Taken" : "Available" : "Inactive";
  }
  function exportFoodList() {
    downloadCsv("gala-food-list.csv", ["#", "Item", "Unit", "Description", "Status"],
      data.foodItems.map((food, index) => [index + 1, food.name, food.unit, food.description, foodStatus(food)]));
  }
  function exportContributions() {
    downloadCsv("gala-contributions.csv", ["#", "Name", "Contribution", "Quantity", "Unit", "Description", "Notes"],
      contributions.map((item, index) => [index + 1, item.guestName, item.foodName, item.quantity, item.unit, foodById.get(item.foodItemId)?.description || "", item.notes]));
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#overview"
          onClick={() => setTab("overview")}
        >
          <span className="brand-mark">✳</span>
          <span>
            Christmas Gala<small>WPVLHC · Assembly of God</small>
          </span>
        </a>
        <p className="eyebrow nav-label">Plan the evening</p>
        <nav aria-label="Management">
          {tabs.map(([id, name]) => (
            <button
              className={tab === id ? "nav-item selected" : "nav-item"}
              key={id}
              onClick={() => {
                setTab(id);
                setSearch("");
                setStatus("");
                setSelectedPeople(new Set());
              }}
            >
              {name}
              <span aria-hidden="true">↗</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <p>
            December 12, 2026
            <br />
            <span>Anna Catherina, Guyana</span>
          </p>
          <button
            className="signout"
            onClick={() =>
              perform(async () => {
                await api("/logout", { method: "POST", body: {} });
                setUser(null);
                setData(null);
                setFoodDeletion(null); setFoodImport(false); setSelectedFoods(new Set());
                setPeopleDeletion(null); setSelectedPeople(new Set());
              })
            }
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="page-header">
          <div>
            <p className="eyebrow">Church management / Christmas 2026</p>
            <h1>{tabs.find(([id]) => id === tab)[1]}</h1>
            <p className="muted">
              {tab === "overview"
                ? "A little planning. A wonderful evening together."
                : tab === "guests"
                  ? "Registered guests, their plus-ones, and a place at the table."
                  : tab === "food"
                    ? "Keep the shared table organised, one contribution at a time."
                    : tab === "churches"
                      ? "Settings for World Prayer Vision Life Healing Center."
                      : tab === "gallery"
                        ? "Share the memories, add your collection, and manage photo visibility."
                        : "See who is bringing what, with quantities and notes."}
            </p>
          </div>
          <button className="secondary" onClick={load} disabled={busy}>
            {busy ? "Refreshing…" : "Refresh ↻"}
          </button>
        </header>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {tab === "gallery" ? <Gallery /> : !data ? (
          <Empty>
            {busy
              ? "Loading the evening's details…"
              : "Unable to load records. Use Refresh to try again."}
          </Empty>
        ) : (
          <>
            <div className="toolbar">
              <p className="church-context">{church?.name || churchName}</p>
              {tab === "overview" && (
                <div className="export-actions">
                  <button className="secondary" onClick={() => perform(exportPeople)}>Export people ↓</button>
                  <button className="secondary" onClick={() => perform(exportFoodList)}>Export food list ↓</button>
                </div>
              )}
            </div>
            {tab === "overview" && (
              <>
                <div className="stats">
                  {[
                    ["People coming", attendingPeople, `${totals.yes} registration${totals.yes === 1 ? "" : "s"} · ${plusOnes} plus-one${plusOnes === 1 ? "" : "s"}`],
                    ["Bringing something", totals.contributors, "Confirmed registered contributors"],
                    ["Food items selected", selectedFoodCount, "Food slots from confirmed contributions"],
                    ["Food items left", availableFoodCount, "Active food slots still available to choose"],
                  ].map(([label, value, detail]) => (
                    <article className="stat" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                      <small>{detail}</small>
                    </article>
                  ))}
                </div>
                <section className="panel">
                  <div className="section-head">
                    <h2>Registration summary</h2>
                    <button className="quiet" onClick={() => setTab("guests")}>View people ↗</button>
                  </div>
                  <Table headers={["Response", "Registrations", "People confirmed"]}>
                    <tr><td>Attending</td><td>{totals.yes}</td><td>{attendingPeople}</td></tr>
                  </Table>
                </section>
                <section className="panel">
                  <div className="section-head">
                    <h2>Food items</h2>
                    <button
                      className="quiet"
                      onClick={() => setTab("contributions")}
                    >
                      View contributions ↗
                    </button>
                  </div>
                  <Table
                    headers={[
                      "Food or drink",
                      "Quantity promised",
                      "People bringing",
                    ]}
                  >
                    {foodRows.map((food) => (
                      <tr key={food.foodItemId}>
                        <td>
                          {food.name}
                          {!food.active && (
                            <small className="muted"> · inactive</small>
                          )}
                        </td>
                        <td>
                          <strong>{food.quantity}</strong> {food.unit}
                        </td>
                        <td>{food.contributors}</td>
                      </tr>
                    ))}
                  </Table>
                  {!foodRows.length && (
                    <Empty>Add food items to begin planning the menu.</Empty>
                  )}
                </section>
              </>
            )}
            {tab === "guests" && (
              <section className="panel">
                <div className="section-head">
                  <h2>
                    Registered people <small>{filteredGuests.length}</small>
                  </h2>
                  <div className="section-actions">
                    <button className="secondary" onClick={() => perform(exportPeople)}>Export people ↓</button>
                    <button onClick={() => setEditor({ kind: "guests" })} disabled={!church?.active}>Add person +</button>
                  </div>
                </div>
                {!church?.active && (
                  <p className="notice">
                    Activate World Prayer Vision in Church settings before adding people.
                  </p>
                )}
                <div className="filters">
                  <label>
                    Find a person
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => { setSearch(event.target.value); setSelectedPeople(new Set()); }}
                      placeholder="Search by name or plus-one"
                    />
                  </label>
                  <label>
                    Reply
                    <select
                      value={status}
                      onChange={(event) => { setStatus(event.target.value); setSelectedPeople(new Set()); }}
                    >
                      <option value="">All replies</option>
                      {Object.entries(statusText).map(([id, label]) => (
                        <option value={id} key={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="food-bulk-actions">
                  <label className="check"><input type="checkbox" aria-label="Select all shown people" checked={filteredGuests.length > 0 && selectedPeopleInView.length === filteredGuests.length} ref={(node) => { if (node) node.indeterminate = selectedPeopleInView.length > 0 && selectedPeopleInView.length < filteredGuests.length; }} onChange={(event) => setSelectedPeople(event.target.checked ? new Set(filteredGuests.map((guest) => guest.id)) : new Set())} />Select all shown people</label>
                  <span className="muted">{selectedPeopleInView.length} selected</span>
                  <button className="secondary danger" disabled={!selectedPeopleInView.length} onClick={() => setPeopleDeletion(selectedPeopleInView)}>Delete selected ({selectedPeopleInView.length})</button>
                </div>
                <Table
                  headers={[
                    "Select",
                    "Name",
                    "Plus-one",
                    "Reply",
                    "Invitation",
                    "Manage",
                  ]}
                >
                  {filteredGuests.map((guest, index) => (
                    <tr key={guest.id}>
                      <td><input className="row-checkbox" type="checkbox" aria-label={`Select person ${index + 1}: ${guest.name}`} checked={selectedPeople.has(guest.id)} onChange={(event) => setSelectedPeople((selected) => { const next = new Set(selected); if (event.target.checked) next.add(guest.id); else next.delete(guest.id); return next; })} /></td>
                      <td>
                        <strong>{guest.name}</strong>
                        <small className="description">{guest.registrationSource === "public" ? "Registered" : "Personal invitation"}</small>
                        {!guest.active && (
                          <small className="inactive">Inactive</small>
                        )}
                      </td>
                      <td>
                        {guest.plusOne ? guest.plusOneName : "—"}
                      </td>
                      <td>
                        <Status value={guest.rsvp} />
                      </td>
                      <td>
                        <button
                          className="quiet"
                          onClick={() => perform(() => copy(guest))}
                        >
                          Copy link
                        </button>
                        <a
                          href={guest.uniqueUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open ↗
                        </a>
                      </td>
                      <td className="actions">
                        <button
                          className="quiet"
                          onClick={() =>
                            setEditor({ kind: "guests", record: guest })
                          }
                        >
                          Edit
                        </button>
                        <button
                          className="quiet"
                          onClick={() =>
                            perform(async () =>
                              setReply(await api(`/guests/${guest.id}`)),
                            )
                          }
                        >
                          Reply
                        </button>
                        <button className="quiet danger" onClick={() => setPeopleDeletion([guest])}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </Table>
                {!filteredGuests.length && (
                  <Empty>No people match this view.</Empty>
                )}
              </section>
            )}
            {tab === "churches" && (
              <section className="panel">
                <div className="section-head"><h2>Church settings</h2></div>
                {church ? (
                  <Table headers={["Church", "Status", "Manage"]}>
                    <tr>
                      <td><strong>{church.name}</strong></td>
                      <td>{church.active ? "Active" : "Inactive"}</td>
                      <td><button className="quiet" onClick={() => setEditor({ kind: "churches", record: church })}>Edit</button></td>
                    </tr>
                  </Table>
                ) : <Empty>World Prayer Vision needs to be restored in the event setup before people can register.</Empty>}
              </section>
            )}
            {tab === "food" && (
              <section className="panel">
                <div className="section-head">
                  <h2>Food & drink catalogue</h2>
                  <div className="section-actions">
                    <button className="secondary" onClick={() => perform(exportFoodList)}>Export food list ↓</button>
                    <button className="secondary" onClick={() => setFoodImport(true)}>Import CSV ↑</button>
                    <button onClick={() => setEditor({ kind: "food-items" })}>Add food item +</button>
                  </div>
                </div>
                <div className="food-bulk-actions">
                  <label className="check"><input type="checkbox" aria-label="Select all food items" checked={data.foodItems.length > 0 && selectedFoods.size === data.foodItems.length} ref={(node) => { if (node) node.indeterminate = selectedFoods.size > 0 && selectedFoods.size < data.foodItems.length; }} onChange={(event) => setSelectedFoods(event.target.checked ? new Set(data.foodItems.map((food) => food.id)) : new Set())} />Select all food items</label>
                  <span className="muted">{selectedFoods.size} selected</span>
                  <button className="secondary danger" disabled={!selectedFoods.size} onClick={() => setFoodDeletion(data.foodItems.filter((food) => selectedFoods.has(food.id)))}>Delete selected ({selectedFoods.size})</button>
                </div>
                <Table headers={["Select", "Item", "Unit", "Description", "Status", "Manage"]}>
                  {data.foodItems.map((food) => (
                    <tr key={food.id}>
                      <td><input className="row-checkbox" type="checkbox" aria-label={`Select ${food.name} (${food.id})`} checked={selectedFoods.has(food.id)} onChange={(event) => setSelectedFoods((selected) => { const next = new Set(selected); if (event.target.checked) next.add(food.id); else next.delete(food.id); return next; })} /></td>
                      <td>
                        <strong>{food.name}</strong>
                      </td>
                      <td>{food.unit}</td>
                      <td>{food.description || "—"}</td>
                      <td>{foodStatus(food)}</td>
                      <td>
                        <button
                          className="quiet"
                          onClick={() =>
                            setEditor({ kind: "food-items", record: food })
                          }
                        >
                          Edit
                        </button>
                        <button className="quiet danger" onClick={() => setFoodDeletion([food])}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </Table>
                {!data.foodItems.length && (
                  <Empty>Add an item for people to bring.</Empty>
                )}
              </section>
            )}
            {tab === "contributions" && (
              <section className="panel">
                <div className="section-head">
                  <h2>Who is bringing what</h2>
                  <span className="muted">
                    {contributions.length} food commitments
                  </span>
                  <button className="secondary" onClick={() => perform(exportContributions)}>Export contributions ↓</button>
                </div>
                <Table
                  headers={[
                    "Name",
                    "Contribution",
                    "Quantity",
                    "Unit",
                    "Description",
                    "Notes",
                  ]}
                >
                  {contributions.map((item) => (
                    <tr key={`${item.guestId}-${item.foodItemId}`}>
                      <td>
                        <strong>{item.guestName}</strong>
                      </td>
                      <td>{item.foodName}</td>
                      <td>{item.quantity}</td>
                      <td>{item.unit}</td>
                      <td>{foodById.get(item.foodItemId)?.description || "—"}</td>
                      <td>{item.notes || "—"}</td>
                    </tr>
                  ))}
                </Table>
                {!contributions.length && (
                  <Empty>
                    Contributions appear here when attending guests save their
                    choices.
                  </Empty>
                )}
              </section>
            )}
            <footer className="workspace-footer">
              An evening of warmth & wonder
              <span>
                Updated{" "}
                {new Date(report.generatedAt).toLocaleString("en-GB", {
                  timeZone: "America/Guyana",
                })}{" "}
                · Guyana time
              </span>
            </footer>
          </>
        )}
        {editor && (
          <RecordEditor
            editor={editor}
            onClose={() => setEditor(null)}
            onSave={saved}
          />
        )}
        {reply && (
          <ReplyEditor
            guest={reply}
            foods={data.foodItems}
            onClose={() => setReply(null)}
            onSave={saved}
          />
        )}
        {foodImport && <FoodImport Modal={Modal} onClose={() => setFoodImport(false)} onRefresh={load} />}
        {foodDeletion && <FoodDelete Modal={Modal} foods={foodDeletion} onClose={() => setFoodDeletion(null)} onRefresh={load} onDeleted={(ids) => setSelectedFoods((selected) => new Set([...selected].filter((id) => !ids.includes(id))))} />}
        {peopleDeletion && <PeopleDelete Modal={Modal} people={peopleDeletion} onClose={() => setPeopleDeletion(null)} onRefresh={load} onDeleted={(ids) => setSelectedPeople((selected) => new Set([...selected].filter((id) => !ids.includes(id))))} />}
      </main>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { allGuests, api, downloadReport } from "./api.js";

const tabs = [
  ["overview", "Overview"],
  ["guests", "Invitations"],
  ["food", "Food & drinks"],
  ["churches", "Churches"],
  ["contributions", "Contributions"],
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
            {headers.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
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
  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
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
          Manage invitations, plan the table, and bring the evening together.
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
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={72}
          />
        </label>
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

function RecordEditor({ editor, churches, onClose, onSave }) {
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
        churchId: form.get("churchId"),
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
            {guest ? "invitation" : food ? "food item" : "church"}
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
            <label>
              Church
              <select
                name="churchId"
                defaultValue={record.churchId || ""}
                required
              >
                <option value="" disabled>
                  Choose a church
                </option>
                {churches
                  .filter(
                    (church) => church.active || church.id === record.churchId,
                  )
                  .map((church) => (
                    <option key={church.id} value={church.id}>
                      {church.name}
                      {!church.active ? " (inactive)" : ""}
                    </option>
                  ))}
              </select>
            </label>
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
        body: { rsvp, items: rsvp === "yes" ? items : [] },
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
  const [churchId, setChurchId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState(null);
  const [reply, setReply] = useState(null);
  useEffect(() => {
    function expired() {
      setUser(null);
      setData(null);
      setEditor(null);
      setReply(null);
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
        allGuests(),
        api("/churches"),
        api("/food-items"),
        api("/reports/summary"),
      ]);
      setData({ guests, churches, foodItems, report });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (user) load();
  }, [user]);
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
      (!churchId || guest.churchId === churchId) &&
      (!status || guest.rsvp === status) &&
      `${guest.name} ${guest.personalizedName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const churches = data?.churches || [];
  const contributions = (report?.contributions || []).filter(
    (item) => !churchId || item.churchId === churchId,
  );
  const churchReport = report?.churches.find(
    (church) => church.churchId === churchId,
  );
  const totals = (churchId ? churchReport : report?.totals) || {
    invited: 0,
    yes: 0,
    no: 0,
    pending: 0,
    contributors: 0,
  };
  const foodRows = (report?.foodItems || []).map((food) =>
    churchId
      ? {
          ...food,
          quantity: contributions
            .filter((row) => row.foodItemId === food.foodItemId)
            .reduce((total, row) => total + row.quantity, 0),
          contributors: contributions.filter(
            (row) => row.foodItemId === food.foodItemId,
          ).length,
        }
      : food,
  );
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
                  ? "Every person, their own invitation and a place at the table."
                  : tab === "food"
                    ? "Keep the shared table organised, one contribution at a time."
                    : tab === "churches"
                      ? "Bring every congregation into the celebration."
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
        {!data ? (
          <Empty>
            {busy
              ? "Loading the evening's details…"
              : "Unable to load records. Use Refresh to try again."}
          </Empty>
        ) : (
          <>
            <div className="toolbar">
              <label>
                Church
                <select
                  value={churchId}
                  onChange={(event) => setChurchId(event.target.value)}
                >
                  <option value="">All churches</option>
                  {churches.map((church) => (
                    <option key={church.id} value={church.id}>
                      {church.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="export-actions">
                <button
                  className="quiet"
                  onClick={() =>
                    perform(() => downloadReport("guests", churchId))
                  }
                >
                  Guest report ↓
                </button>
                <button
                  className="quiet"
                  onClick={() =>
                    perform(() => downloadReport("food", churchId))
                  }
                >
                  Food report ↓
                </button>
              </div>
            </div>
            {tab === "overview" && (
              <>
                <div className="stats">
                  {[
                    ["Invited", totals.invited],
                    ["Attending", totals.yes],
                    ["Awaiting reply", totals.pending],
                    ["Bringing something", totals.contributors],
                  ].map(([label, value]) => (
                    <article className="stat" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                      <small>
                        {label === "Invited"
                          ? "Active invitations"
                          : label === "Attending"
                            ? `${totals.no} declined`
                            : label === "Awaiting reply"
                              ? "A friendly follow-up helps"
                              : "Confirmed contributors"}
                      </small>
                    </article>
                  ))}
                </div>
                <section className="panel">
                  <div className="section-head">
                    <h2>Attendance by church</h2>
                    <span className="muted">
                      {totals.invited
                        ? Math.round((totals.yes / totals.invited) * 100)
                        : 0}
                      % attending
                    </span>
                  </div>
                  {!churches.length ? (
                    <Empty>
                      Add your first church to start creating invitations.
                    </Empty>
                  ) : (
                    <Table
                      headers={[
                        "Church",
                        "Invited",
                        "Attending",
                        "Declined",
                        "Pending",
                      ]}
                    >
                      {report.churches
                        .filter(
                          (church) => !churchId || church.churchId === churchId,
                        )
                        .map((church) => (
                          <tr key={church.churchId}>
                            <td>
                              <strong>{church.name}</strong>
                            </td>
                            <td>{church.invited}</td>
                            <td>{church.yes}</td>
                            <td>{church.no}</td>
                            <td>{church.pending}</td>
                          </tr>
                        ))}
                    </Table>
                  )}
                </section>
                <section className="panel">
                  <div className="section-head">
                    <h2>For the shared table</h2>
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
                    Personal invitations <small>{filteredGuests.length}</small>
                  </h2>
                  <button
                    onClick={() => setEditor({ kind: "guests" })}
                    disabled={!churches.some((church) => church.active)}
                  >
                    Add invitation +
                  </button>
                </div>
                {!churches.some((church) => church.active) && (
                  <p className="notice">
                    Add an active church before creating invitations.
                  </p>
                )}
                <div className="filters">
                  <label>
                    Find a person
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search by name"
                    />
                  </label>
                  <label>
                    Reply
                    <select
                      value={status}
                      onChange={(event) => setStatus(event.target.value)}
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
                <Table
                  headers={[
                    "Person",
                    "Church",
                    "Reply",
                    "Invitation",
                    "Manage",
                  ]}
                >
                  {filteredGuests.map((guest) => (
                    <tr key={guest.id}>
                      <td>
                        <strong>{guest.name}</strong>
                        {!guest.active && (
                          <small className="inactive">Inactive</small>
                        )}
                      </td>
                      <td>
                        {
                          churches.find(
                            (church) => church.id === guest.churchId,
                          )?.name
                        }
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
                      </td>
                    </tr>
                  ))}
                </Table>
                {!filteredGuests.length && (
                  <Empty>No invitations match this view.</Empty>
                )}
              </section>
            )}
            {tab === "churches" && (
              <section className="panel">
                <div className="section-head">
                  <h2>Church directory</h2>
                  <button onClick={() => setEditor({ kind: "churches" })}>
                    Add church +
                  </button>
                </div>
                <Table headers={["Church", "Status", "Manage"]}>
                  {churches
                    .filter((church) => !churchId || church.id === churchId)
                    .map((church) => (
                      <tr key={church.id}>
                        <td>
                          <strong>{church.name}</strong>
                        </td>
                        <td>{church.active ? "Active" : "Inactive"}</td>
                        <td>
                          <button
                            className="quiet"
                            onClick={() =>
                              setEditor({ kind: "churches", record: church })
                            }
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                </Table>
                {!churches.length && (
                  <Empty>No churches yet. Add the first congregation.</Empty>
                )}
              </section>
            )}
            {tab === "food" && (
              <section className="panel">
                <div className="section-head">
                  <h2>Food & drink catalogue</h2>
                  <button onClick={() => setEditor({ kind: "food-items" })}>
                    Add food item +
                  </button>
                </div>
                <Table headers={["Item", "Unit", "Status", "Manage"]}>
                  {data.foodItems.map((food) => (
                    <tr key={food.id}>
                      <td>
                        <strong>{food.name}</strong>
                        <small className="description">
                          {food.description}
                        </small>
                      </td>
                      <td>{food.unit}</td>
                      <td>{food.active ? "Available" : "Inactive"}</td>
                      <td>
                        <button
                          className="quiet"
                          onClick={() =>
                            setEditor({ kind: "food-items", record: food })
                          }
                        >
                          Edit
                        </button>
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
                </div>
                <Table
                  headers={[
                    "Person",
                    "Church",
                    "Food or drink",
                    "Quantity",
                    "Notes",
                  ]}
                >
                  {contributions.map((item) => (
                    <tr key={`${item.guestId}-${item.foodItemId}`}>
                      <td>
                        <strong>{item.guestName}</strong>
                      </td>
                      <td>{item.churchName}</td>
                      <td>{item.foodName}</td>
                      <td>
                        {item.quantity} {item.unit}
                      </td>
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
            churches={churches}
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
      </main>
    </div>
  );
}

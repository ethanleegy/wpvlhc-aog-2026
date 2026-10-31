# Frontend API handoff · Christmas Gala

The complete machine-readable contract is [openapi.json](openapi.json), OpenAPI 3.0.3. This document explains how to connect the existing Jekyll UI. Stack: Node.js 24, Express 5, Joi, Firebase Functions v2 and Firestore.

## Base URLs

| Environment | API base, including `/v1` |
| --- | --- |
| Local Functions emulator | `http://127.0.0.1:5001/demo-wpvlhc/us-central1/api/v1` |
| Deployed public API | `https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/api/v1` |
| Management on Firebase Hosting / Vite proxy | `/v1` |

The backend developer supplies the real deployed base URL. Public API calls need no Firebase SDK, API key or admin cookie. Add the public site's exact origin to backend `ALLOWED_ORIGINS`. Do not expose admin credentials in public JavaScript.

## Personal invitation flow

1. Management creates a church, then a named person through `POST /admin/guests`. The server generates their code and `uniqueUrl`, for example `https://public-site.example/gala/?token=a1b2c3d4e5f678901234567`.
2. The public page reads **`token`** from the query string and calls `GET /token/{token}`. Use returned `personalizedName` for the greeting and `name` for the person's full name. Render names/notes with `textContent`, not HTML.
3. Fetch `GET /food-items` for current menu IDs, labels, descriptions and units. Restore any existing selections from the invitation's `items` array. Previously selected inactive items may be absent from the catalogue; the invitation includes their name/unit so they can still be shown.
4. On an attending reply, submit `POST /token/{token}/reply` with `rsvp:"yes"` and the complete food choices. The guest may bring nothing: `items:[]` is valid.
5. On a declined reply, submit immediately with `rsvp:"no", items:[]`. The current public UI hides the food form on decline, so **do not wait for that form's submit button** to save the declined response.
6. Show success only after a successful HTTP response. Disable submission while saving; show server errors and permit retry. A repeat submission replaces choices without duplicate contributions. Reloading the invitation restores the latest saved state.

One code represents **one person**. The public page cannot change the person's identity or church. `?name=` only changes the old demo greeting and is not an invitation credential. Codes are 24 lowercase hexadecimal characters and remain usable after a response until management deactivates the invitation. The chosen query form works with static Jekyll hosting and subpaths; the API itself uses URI parameters.

For missing/malformed codes, display an invitation-link message and do not submit anonymously. For unknown codes (404), inactive codes (410) or network failures, keep the form disabled until a valid invitation loads. No public directory of guests exists. Keep codes out of analytics, logs, third-party links and browser storage. The layout includes a no-referrer policy.

**Current integration boundary:** `assets/js/site.js` is the original local demo. It must be updated by the frontend developer. Its dish `value` strings from YAML are labels, not API IDs. Render the menu from `/food-items` or explicitly map fetched IDs; never send the label as `foodItemId`.

## Public endpoints

| Method | Path | Success |
| --- | --- | --- |
| GET | `/ready` | 200, liveness only |
| GET | `/token/{token}/status` | 200, name/greeting, `valid:true`, saved RSVP and response timestamp |
| GET | `/token/{token}` | 200, person, church, RSVP and saved food choices |
| GET | `/food-items` | 200, `{foodItems:[{id,name,description,unit}]}`; available options only |
| POST | `/token/{token}/reply` | 200, saved `{token,rsvp,items}` |

Invitation response example:

```json
{
  "token": "a1b2c3d4e5f678901234567",
  "name": "Pat Henry",
  "personalizedName": "Pastor Pat",
  "church": {"id": "wpvlhc-aog", "name": "World Prayer Vision Life Healing Center Assembly of God"},
  "rsvp": "pending",
  "items": [],
  "respondedAt": null,
  "updatedAt": "2026-10-31T18:00:00.000Z"
}
```

Reply payload:

```json
{
  "rsvp": "yes",
  "items": [
    {"foodItemId": "food-07", "quantity": 12, "notes": "Vegetarian"},
    {"foodItemId": "food-11", "quantity": 20, "notes": ""}
  ]
}
```

Rules: `rsvp` is exactly `yes` or `no`; `items` is required even when empty; at most 30 distinct `foodItemId` values; `quantity` is a JSON integer, 1–10,000; optional `notes` defaults to `""`, at most 500 characters. Declining requires `items:[]`. Strings must be trimmed. Unknown fields, duplicate items, numeric strings, zero/fractional quantities and non-JSON requests are rejected. Map stored response items to `{foodItemId,quantity,notes}` before sending; response-only `name`/`unit` fields are not accepted in requests.

Existing inactive options may be retained at the same/lower quantity or removed; increasing or newly adding one returns 409. Refresh the catalogue and invite state after 409, and preserve unsaved input so the guest can resolve the change. The unit means what management configured for that item; do not assume every item is measured in servings.

```js
const API = "http://127.0.0.1:5001/demo-wpvlhc/us-central1/api/v1";
const token = new URL(window.location.href).searchParams.get("token");

async function publicApi(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "omit",
    ...(body === undefined ? {} : {
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    const failure = new Error(data.error?.message || "Unable to save. Please try again.");
    failure.status = response.status;
    failure.code = data.error?.code;
    throw failure;
  }
  return data;
}

// Run inside the page's loading/error handling; disable forms until this succeeds.
if (!token || !/^[a-f0-9]{24}$/.test(token)) {
  throw new Error("Please open your personal invitation link.");
}
const [invitation, menu] = await Promise.all([
  publicApi(`/token/${encodeURIComponent(token)}`),
  publicApi("/food-items"),
]);
document.querySelectorAll("[data-invitee]").forEach((node) => {
  node.textContent = invitation.personalizedName;
});
// Render menu.foodItems and restore invitation.items using IDs.

// Convert a quantity input using Number(input.value) before building this object.
await publicApi(`/token/${encodeURIComponent(token)}/reply`, {
  rsvp: "yes",
  items: [{foodItemId: "food-07", quantity: 12, notes: "Vegetarian"}],
});
// Declining: await publicApi(`/token/${encodeURIComponent(token)}/reply`, {rsvp:"no", items:[]});
```

The example uses top-level await: use it in an ES module or wrap it in your initialization function. The current deferred classic `site.js` needs the latter or a script type change.

## Management API

The React app already consumes these endpoints. All paths below are prefixed with `/v1/admin`.

| Method | Path | Request/result |
| --- | --- | --- |
| POST | `/login` | `{username,password}` → `{username,expiresIn:28800}` and `__session` cookie |
| GET | `/session` | `{username}` or 401 |
| POST | `/logout` | `{}` → 204; clear cookie |
| GET | `/churches` | `{churches:[...]}` including inactive |
| POST | `/churches` | `{name,active?}` → 201 church |
| PATCH | `/churches/{id}` | Nonempty subset of `name,active` → church |
| GET | `/food-items` | `{foodItems:[...]}` including inactive |
| POST | `/food-items` | `{name,unit,description?,active?}` → 201 food item |
| PATCH | `/food-items/{id}` | Nonempty subset of `name,unit,description,active` → item |
| GET | `/guests` | `{guests:[...],nextCursor}`; query: `churchId,rsvp,limit,after` |
| POST | `/guests` | `{name,churchId,personalizedName?,active?}` → 201 person, generated `token,uniqueUrl` |
| GET | `/guests/{id}` | Person and saved `items`, including inactive invitations |
| PATCH | `/guests/{id}` | Nonempty subset of `name,churchId,personalizedName,active` → person |
| POST | `/guests/{id}/reply` | Same reply payload as public API; correct response on behalf of person |
| GET | `/reports/summary` | Overall/per-church RSVP counts, per-item quantities and detailed contributions |
| GET | `/reports/guests.csv` | Guest CSV, including private invitation links |
| GET | `/reports/food.csv` | Food commitments by person, church, item, quantity/unit and notes |

Every management mutation requires JSON plus `X-Admin-Request: true`, including login/logout. Use the same origin as the dashboard and `credentials:"same-origin"`; the session cookie is HttpOnly, Secure in production and SameSite=Strict. Do not read/store a JWT in JavaScript. Passwords are limited to 72 UTF-8 bytes because bcrypt uses that limit. Admin credentials are configured server-side.

```js
await fetch("/v1/admin/login", {
  method: "POST",
  credentials: "same-origin",
  headers: {"Content-Type": "application/json", "X-Admin-Request": "true"},
  body: JSON.stringify({username, password}),
});
// Subsequent admin fetches include the HttpOnly cookie automatically.
```

Guest pagination defaults to 50, maximum 100. Results include active/inactive guests ordered by document ID. Pass returned `nextCursor` as `after`, retaining the same `churchId`/`rsvp` filters, until null. `rsvp` filters accept `yes`, `no` or `pending`. No total count is implied by a single page; use summary reports for active guest counts.

IDs and URLs are server-generated and immutable. New/reassigned guests require an active church. Set `active:false` to deactivate; deletion endpoints are intentionally absent. Inactive guest links return 410; reports exclude them until reactivated. Inactive church/food records keep history. Once a food item has received any contribution, changing its unit returns 409; create a new item for a different unit.

Reports accept optional `?churchId=<id>` and reflect a consistent snapshot of active invitations. `yes`, `no` and `pending` add up to `invited`; `contributors` counts attending people with at least one food item. Food totals are per item/unit, never summed across unrelated units. `contributions` lists each person/item once. Church reassignment moves the person's report entries automatically. CSVs contain a UTF-8 BOM/CRLF, escaped cells and formula neutralization.

## Errors and limits

Errors use one envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please check the request fields",
    "details": [{"field": "items.0.quantity", "message": "\"items[0].quantity\" must be a number"}],
    "requestId": "00000000-0000-4000-8000-000000000001"
  }
}
```

`details` appears only on validation errors. Share `requestId` when reporting a failure, without sharing a person's full invitation URL.

| Status | Meaning / frontend action |
| --- | --- |
| 400 | Malformed code/JSON, missing/wrong/unknown fields; show validation errors |
| 401 | Admin sign-in required or credentials wrong; prompt sign-in |
| 403 | Browser origin blocked or management mutation header missing |
| 404 | Invitation/record not found |
| 409 | Inactive food/church or locked food unit; refresh and resolve |
| 410 | Invitation disabled; show church contact message |
| 413 | Request body over 32 KB |
| 415 | Send `Content-Type: application/json` |
| 429 | Rate limit; `Retry-After: 900` seconds; wait before retrying |
| 500 | Server/configuration failure; preserve input and allow retry |

Public submissions allow 60 attempts per invitation per 15 minutes; admin login allows 10 attempts per observed IP per 15 minutes. Database-backed limits are shared across instances. All API responses are private/no-store. Unknown codes and failed database writes must never appear as a successful RSVP in the UI.

## Local handoff checklist

Use the setup in [firebase/README.md](../firebase/README.md). Seed the church/menu, create a person from React management, and test the generated `?token=` link on the Jekyll site after wiring the forms. Check initial/repeat replies, attending without food, declining, restoring saved choices, inactive options/links and visible server errors. Public integration is complete only when management reports show the submitted changes.

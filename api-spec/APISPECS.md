# Frontend API handoff · Christmas Gala

The complete machine-readable contract is [openapi.json](openapi.json), OpenAPI 3.0.3. This document explains how to connect the existing Jekyll UI. Stack: Node.js 24, Express 5, Joi, Firebase Functions v2 and Firestore.

## Base URLs

| Environment | API base, including `/v1` |
| --- | --- |
| Local Functions emulator | `http://127.0.0.1:5001/demo-wpvlhc/us-central1/api/v1` |
| Deployed public API | `https://wpvlhc-aog-2026.web.app/v1` |
| Direct deployed function | `https://us-central1-wpvlhc-aog-2026.cloudfunctions.net/api/v1` |
| Management on Firebase Hosting / Vite proxy | `/v1` |

Use the absolute deployed API URL on the public Jekyll site. The public invitation domain (`https://wpvlhc-gala-2026.ivory-gy.com`) serves the Jekyll pages; it does not serve `/v1` API routes. The relative `/v1` base works on the Firebase management host and through the local Vite proxy. Public API calls need no Firebase SDK, API key or admin cookie. Add the public site's exact origin to backend `ALLOWED_ORIGINS`. Do not expose admin credentials in public JavaScript.

## Shared-link public registration

Added alongside the personal invitation flow: `POST /registrations`. This backend endpoint is available after deploying the API update. The frontend developer owns the user flow; no public or management UI files are changed by this addition.

The endpoint registers **one named primary attendee, optionally with one named companion**. The server assigns `churchId:"wpvlhc-aog"`, `rsvp:"yes"`, `active:true` and `registrationSource:"public"`. The `wpvlhc-aog` church must already exist and be active. A shared-link visitor choosing not to attend creates no guest record and does not call this endpoint. Existing personal-code decline/update endpoints remain available.

Use the existing `GET /food-items` catalogue for IDs and units. The public endpoint requires only JSON, with `credentials:"omit"`; no admin session, admin header, Firebase SDK or API key is required.

```http
POST https://wpvlhc-aog-2026.web.app/v1/registrations
Content-Type: application/json
```

```json
{
  "requestId": "62c72547-8a62-4126-9b0e-10ee3e7a50ec",
  "name": "John Henry",
  "plusOne": true,
  "plusOneName": "Jane Henry",
  "items": [
    {"foodItemId": "gala-food-034", "quantity": 12, "notes": ""}
  ]
}
```

New registration: **201**. An identical successful retry: **200**, returning the same original receipt:

```json
{
  "token": "a1b2c3d4e5f678901234567",
  "name": "John Henry",
  "churchId": "wpvlhc-aog",
  "rsvp": "yes",
  "plusOne": true,
  "plusOneName": "Jane Henry",
  "items": [
    {"foodItemId": "gala-food-034", "quantity": 12, "notes": "", "name": "Example dish", "unit": "servings"}
  ]
}
```

The dish name/unit above are illustrative; the API supplies the actual catalogue values. `items:[]` is valid. Name is required, trimmed and at most 160 characters. Item rules are identical to existing replies: up to 30 distinct IDs, integer quantities 1–10,000 and optional trimmed notes up to 500 characters. Do not send `rsvp`, `churchId`, `active`, `token`, `registrationSource` or response-only food name/unit fields; unexpected fields return 400.

Generate a private UUIDv4 `requestId` once per submission, for example with `crypto.randomUUID()`. Reuse it across double clicks, timeouts and retries. UUID case, food-array order, JSON object-field order and omitted versus empty notes do not affect replay. Keep the ID private: anyone holding it and the matching submission can retrieve the receipt and guest code. Do not log it, put it in URLs or send it to analytics. Persist unfinished request information only as needed for recovery and clear it when no longer needed.

Guest creation, food reservation, contribution and receipt commit atomically. A taken/inactive/missing slot creates no partial guest or successful request record. After such a rejection, the request ID may be reused with corrected choices. After success, reusing it with changed information returns `409 REQUEST_CHANGED`. Replays return the **original receipt** and never undo subsequent RSVP/admin changes. Load `GET /token/{token}` for current state and use existing `POST /token/{token}/reply` for later RSVP/food changes; public identity/name edits remain admin-only.

| Error | Handling |
| --- | --- |
| `400 VALIDATION_ERROR` | Check request ID, name, item IDs/quantities and unexpected fields. |
| `404 NOT_FOUND` | A selected food record does not exist; refresh the catalogue. |
| `409 FOOD_ITEM_TAKEN` / `FOOD_ITEM_INACTIVE` | Refresh available choices and preserve unsaved input. |
| `409 REQUEST_CHANGED` | The ID already has a successful receipt; use that guest's code for edits. |
| `429 RATE_LIMITED` | Honor `Retry-After: 900`; limit is 500 validated attempts per observed IP per 15 minutes, including retries. |
| `503 REGISTRATION_UNAVAILABLE` | The server-assigned church is missing or inactive; operator action is needed. |

Registrations appear in the existing management list, attendance/food reports and CSVs. Existing `totals.invited` remains the count of active primary guest records, including these public registrations. Use `totals.attendingPeople` for confirmed people including companions. Anonymous declines are not included. Names are **not identities**: a different request ID creates a new primary guest, even if the name already exists on an invitation. This protects existing invitations from being claimed or overwritten by name alone; it is not cross-device duplicate-person detection.

## Named plus-one contract

This is an additive backend change in API version 1.3.0. Deploy the API before sending these fields. The frontend developer handles the prompts: attendee's own name, whether they are bringing a plus-one, then the companion's name when Yes is selected. No UI files are changed by this backend update.

The same companion fields are supported by `POST /registrations`, `POST /token/{token}/reply`, `POST /admin/guests`, `PATCH /admin/guests/{id}` and `POST /admin/guests/{id}/reply`:

| Input | Meaning |
| --- | --- |
| `"plusOne":true,"plusOneName":"Jane Henry"` | Add or rename one companion; both fields required for this choice. |
| `"plusOne":false` | No companion; clears any saved companion name. `plusOneName:""` may also be sent. |
| Both omitted | On create, no companion. On an attending RSVP/admin update, preserve the saved companion. |

`plusOne` must be a JSON boolean, not `"yes"`, `"true"` or a number. With `plusOne:true`, `plusOneName` must be a nonempty, already trimmed string of at most 160 characters; trim it before submitting. Names containing only whitespace fail. Sending the name without the flag, or a nonempty name with `plusOne:false`, returns `400 VALIDATION_ERROR`. A name-only update is not supported: resend `plusOne:true` with the corrected name.

Declining through a personal-code or admin reply clears both fields, even when an older client omits them. `rsvp:"no"` with `plusOne:true` is invalid. Adding a companion through admin PATCH to an already declined guest also returns 400; use the admin reply endpoint to record `rsvp:"yes"` and the companion together. Pending admin-created invitations can record a companion, but neither person is counted as confirmed until the RSVP is Yes.

`GET /token/{token}`, its `/status` endpoint, saved reply responses, registration receipts and admin guest list/detail/create/edit responses all include `plusOne` and `plusOneName`. Old records return `false` and `""` without a data migration. Companion details have the same private access as the primary guest; there is no public guest directory. Render both names as text, not HTML.

The companion stays on the primary guest record: no second token, invitation, independent food reservation or gallery identity is created. Food quantities are still the explicitly selected amounts, never automatically doubled. The primary guest's `name` remains admin-only to edit after registration; public replies can edit only the companion name and existing RSVP/food fields.

Companion details participate in registration retry matching. After success, changing the flag or companion name with the same `requestId` returns `409 REQUEST_CHANGED`; use the returned guest code for later edits. Omitting companion fields and explicitly sending `false`/`""` are equivalent, including for receipts created before this release. Old receipts return the added fields as `false`/`""`; replay never overwrites later companion changes.

Overall and per-church reports add `plusOnes` (companions of active Yes replies) and `attendingPeople` (`yes + plusOnes`). For example, 10 confirmed primary guests with four companions means `yes:10`, `plusOnes:4`, `attendingPeople:14`. Existing invitation/RSVP/contributor counts keep their meanings. Guest CSVs append `Plus one` and `Plus-one name` columns, retaining one row per primary guest. The admin frontend must explicitly display the new fields/headcount; its existing Yes tile still counts primary registrations.

## Personal invitation flow

This existing flow remains supported. The code requirements below apply to personal invitation links; shared-link registration above does not require a code.

1. Management creates a church, then a named person through `POST /admin/guests`. The server generates their code and `uniqueUrl`, for example `https://public-site.example/gala/?token=a1b2c3d4e5f678901234567`.
2. The public page reads **`token`** from the query string and calls `GET /token/{token}`. Use returned `personalizedName` for the greeting and `name` for the person's full name. Render names/notes with `textContent`, not HTML.
3. Fetch `GET /food-items` for current menu IDs, labels, descriptions and units. Each record is a single-person slot; repeated names have different IDs and must be rendered separately. Claimed slots disappear from this list, including the guest's own slots. Restore saved selections from the invitation's `items` array, which includes their name/unit.
4. On an attending reply, submit `POST /token/{token}/reply` with `rsvp:"yes"` and the complete food choices. The guest may bring nothing: `items:[]` is valid.
5. On a declined reply, submit immediately with `rsvp:"no", items:[]`. The current public UI hides the food form on decline, so **do not wait for that form's submit button** to save the declined response.
6. Show success only after a successful HTTP response. Disable submission while saving; show server errors and permit retry. A repeat submission replaces choices without duplicate contributions. Reloading the invitation restores the latest saved state.

One code represents **one primary attendee and their optional named plus-one**. The public page cannot change the primary person's identity or church. `?name=` only changes the old demo greeting and is not an invitation credential. Codes are 24 lowercase hexadecimal characters and remain usable after a response until management deactivates the invitation. The chosen query form works with static Jekyll hosting and subpaths; the API itself uses URI parameters.

For missing/malformed codes, display an invitation-link message and do not submit anonymously. For unknown codes (404), inactive codes (410) or network failures, keep the form disabled until a valid invitation loads. No public directory of guests exists. Keep codes out of analytics, logs, third-party links and browser storage. The layout includes a no-referrer policy.

**Current integration boundary:** `assets/js/site.js` is the original local demo. It must be updated by the frontend developer. Its dish `value` strings from YAML are labels, not API IDs. Render the menu from `/food-items` or explicitly map fetched IDs; never send the label as `foodItemId`.

## Public endpoints

| Method | Path | Success |
| --- | --- | --- |
| GET | `/ready` | 200, liveness only; no cross-origin browser access |
| GET | `/token/{token}/status` | 200, name/greeting, `valid:true`, saved RSVP, companion fields and response timestamp |
| GET | `/token/{token}` | 200, person, church, RSVP, companion fields and saved food choices |
| GET | `/food-items` | 200, `{foodItems:[{id,name,description,unit}]}`; active, unclaimed slots only |
| POST | `/registrations` | 201 new attending guest, or 200 original receipt on identical retry; `{requestId,name,items,plusOne?,plusOneName?}` |
| POST | `/token/{token}/reply` | 200, saved `{token,rsvp,plusOne,plusOneName,items}` |

Invitation response example:

```json
{
  "token": "a1b2c3d4e5f678901234567",
  "name": "Pat Henry",
  "personalizedName": "Pastor Pat",
  "church": {"id": "wpvlhc-aog", "name": "World Prayer Vision Life Healing Center Assembly of God"},
  "rsvp": "pending",
  "plusOne": false,
  "plusOneName": "",
  "items": [],
  "respondedAt": null,
  "updatedAt": "2026-10-31T18:00:00.000Z"
}
```

Reply payload:

```json
{
  "rsvp": "yes",
  "plusOne": true,
  "plusOneName": "Jane Henry",
  "items": [
    {"foodItemId": "gala-food-034", "quantity": 12, "notes": "Vegetarian"},
    {"foodItemId": "gala-food-136", "quantity": 20, "notes": ""}
  ]
}
```

Rules: `rsvp` is exactly `yes` or `no`; `items` is required even when empty; at most 30 distinct `foodItemId` values; `quantity` is a JSON integer, 1–10,000; optional `notes` defaults to `""`, at most 500 characters. Declining requires `items:[]`. Strings must be trimmed. Unknown fields, duplicate items, numeric strings, zero/fractional quantities and non-JSON requests are rejected. Map stored response items to `{foodItemId,quantity,notes}` before sending; response-only `name`/`unit` fields are not accepted in requests.

Existing inactive options may be retained at the same/lower quantity or removed; increasing or newly adding one returns 409. Refresh the catalogue and invite state after 409, and preserve unsaved input so the guest can resolve the change. The unit means what management configured for that item; do not assume every item is measured in servings.

One slot can belong to only one person. For example, Baked chicken appears three times as `gala-food-001`, `gala-food-002` and `gala-food-003`, allowing up to three separate contributors. `quantity` is the amount that person brings, not the number of people permitted to claim a slot. Concurrent claims for the same ID produce one success and `409 FOOD_ITEM_TAKEN` for the other request. Refresh available slots and ask the guest to choose another. Removing a selection or declining releases it; repeat saves by the owner retain it. Request and response shapes are unchanged.

```js
const API = "https://wpvlhc-aog-2026.web.app/v1";
// Local: http://127.0.0.1:5001/demo-wpvlhc/us-central1/api/v1
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

// Call this only from the guest's reply/save event handler.
// Convert quantity inputs using Number(input.value) when building selections.
async function saveReply(rsvp, selections = [], companion) {
  const companionFields = rsvp === "no" ? {plusOne: false} : companion === undefined ? {} : companion.plusOne ? {
    plusOne: true, plusOneName: companion.plusOneName.trim(),
  } : {plusOne: false};
  return publicApi(`/token/${encodeURIComponent(token)}/reply`, {
    rsvp,
    ...companionFields,
    items: rsvp === "no" ? [] : selections.map(({foodItemId, quantity, notes}) => ({
      foodItemId, quantity, notes: (notes ?? "").trim(),
    })),
  });
}
// From the save handler: await saveReply("yes", selectedItems, {plusOne: true, plusOneName: companionName});
// Explicitly remove the companion: await saveReply("yes", selectedItems, {plusOne: false});
// Older clients may omit the third argument to preserve the saved companion.
// From the decline handler: await saveReply("no");
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
| POST | `/guests` | `{name,churchId,personalizedName?,active?,plusOne?,plusOneName?}` → 201 person, generated `token,uniqueUrl` |
| GET | `/guests/{id}` | Person and saved `items`, including inactive invitations |
| PATCH | `/guests/{id}` | Nonempty subset of `name,churchId,personalizedName,active,plusOne,plusOneName`; companion pairing rules apply |
| POST | `/guests/{id}/reply` | Same reply payload as public API; correct response on behalf of person |
| GET | `/reports/summary` | Overall/per-church RSVP counts, `plusOnes`, `attendingPeople`, per-item quantities and detailed contributions |
| GET | `/reports/guests.csv` | Guest CSV, including private invitation links and companion fields |
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

Deactivating a guest retains their food reservations. To also free those slots, record a declined reply or an empty food selection through the admin reply endpoint. The admin food list includes `claimedBy` (the owning guest code, or null); public food responses never expose it.

Reports accept optional `?churchId=<id>` and reflect a consistent snapshot of active invitations. `yes`, `no` and `pending` add up to `invited`; these count primary guest records. `plusOnes` counts confirmed companions and `attendingPeople` is `yes + plusOnes`. `contributors` counts attending primary guests with at least one food item. Food totals are per item/unit, never summed across unrelated units or multiplied by companions. `contributions` lists each primary person/item once. Church reassignment moves both people's attendance and the primary person's commitments automatically. CSVs contain a UTF-8 BOM/CRLF, escaped cells and formula neutralization. Guest CSV columns are `Name, Church, RSVP, Invitation URL, Responded at, Plus one, Plus-one name`.

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
| 409 | Slot already taken (`FOOD_ITEM_TAKEN`), inactive food/church or locked unit; refresh and resolve |
| 410 | Invitation disabled; show church contact message |
| 413 | Request body over 32 KB |
| 415 | Send `Content-Type: application/json` |
| 429 | Rate limit; `Retry-After: 900` seconds; wait before retrying |
| 500 | Server/configuration failure; preserve input and allow retry |

Public submissions allow 60 attempts per invitation per 15 minutes; admin login allows 10 attempts per observed IP per 15 minutes. Database-backed limits are shared across instances. All API responses are private/no-store. Unknown codes and failed database writes must never appear as a successful RSVP in the UI.

## Local handoff checklist

Use the setup in [firebase/README.md](../firebase/README.md). Seed the church/menu, create a person from React management, and test the generated `?token=` link on the Jekyll site after wiring the forms. Check initial/repeat replies, attending without food, declining, restoring saved choices, inactive options/links and visible server errors. Public integration is complete only when management reports show the submitted changes.

## Photo gallery integration

The gallery is implemented locally and remains disabled on production until configured and deployed. Its complete Firebase route contract is in `openapi.json`; browser binaries are uploaded to the separate Cloudflare Worker, never as base64/JSON through Firebase.

Guest flow: scan the shared page QR → take/choose → preview → Share photos. Use `GET /gallery/policy` for compression limits and Turnstile configuration. Create a verified session with `POST /gallery/sessions`, then authorize compressed variants with `POST /gallery/uploads`. Send each JPEG/WebP Blob with PUT to its returned URL and the exact `Content-Type` and `X-Gallery-Ticket`. Call completion and use the authoritative state: `ready + approved + published` means visible. Automatic publication is the default; prior approval yields a private pending photo.

Reuse the shared queue/compressor in `gallery-client/src/`. Both guest and admin uploads produce a thumbnail of at most 400 px / 50,000 bytes and a display image of at most 1,600 px / 500,000 bytes, without uploading originals. HEIC conversion runs on the device when needed. Maintain the same request/item IDs on retries. Resolve completion before requesting replacement upload permission; no more than three transfer attempts are permitted for a photo.

`GET /gallery/photos?limit=20&after=...` returns only published photos with IDs, thumbnail/display URLs, dimensions and publication dates. Treat `nextCursor` as opaque. Viewing links expire within five minutes; GET /gallery/photos/{photoId} refreshes links for one currently published photo without resetting the viewer's position. Hidden photos return 404. The matching admin detail endpoint refreshes private previews. Never place the completion capability, uploader data or private preview URLs in a public feed. The supplied guest page updates its own newly published photos without reloading.

Management uses the existing same-origin session and mutation header. Settings control prior approval and separate guest/admin upload switches. Admin uploads belong to idempotent batches with `follow`, `publish` or `review` publication choices. `/admin/gallery/photos` supports visible/hidden/pending/failed filters, batch filtering and pagination. `/admin/gallery/actions` accepts at most 25 explicit photo IDs with action `show` or `hide`, returning per-item results. Hiding removes a photo from fresh feeds immediately; existing image links/caches can remain usable for up to five minutes. The current implementation relies on expiry rather than instant global purging. Unapproving never deletes the private retained variants.

All `/internal/gallery/*` routes are Worker-only and require a separate bearer secret; do not call them from browser code. Cloudflare requests and R2 usage are bounded for the $0 target, so uploads or viewing can pause at a limit or expired account review. Show a useful retry/availability state rather than silently bypassing the gateway. The local guide explains how to exercise the full flow without production resources.

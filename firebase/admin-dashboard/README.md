# Christmas Social management dashboard

React + Vite management for WPVLHC AOG's December 2026 Christmas Social. Uses the Node/Firestore backend in `../functions`; it contains no browser Firestore SDK, database credentials or stored admin password.

The React management app uses Christmas Social branding in its page title, headings, CSV exports, import template and photo-sharing QR download. Public Jekyll pages and the guest gallery are maintained separately by the public frontend developer. Direct backend CSV downloads use `christmas-social-guests.csv` and `christmas-social-food.csv`.

## Development

Configure and start the emulators as described in [Firebase setup](../README.md). From the repository root:

```sh
npm ci --prefix firebase/admin-dashboard
npm run admin:dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/v1` to `http://127.0.0.1:5001/demo-wpvlhc/us-central1/api`. For another local backend, copy `.env.example` to `.env.local` here and change `API_PROXY_TARGET`. Allow the browser origin in the backend's `ALLOWED_ORIGINS`.

## Views

- **Sign in:** eye button reveals/hides the password without submitting; password is hidden again on submission and after signing out.
- **Overview:** four cards show people coming (including confirmed plus-ones), registered contributors, distinct selected food slots, and active slots left to choose. Selected slots come from active attending contributions, not serving quantities or distinct dish names; duplicate dish names with different IDs count separately. Inactive/unclaimed options and retained claims from inactive people do not count as available. The registration summary shows attending registrations and confirmed people only.
- **People:** registrations and existing personal invitations; companion names; search by primary/greeting/companion name and filter by RSVP; copy/open links; edit/deactivate or permanently delete single/selected people; correct replies/food/plus-one details. Adding a person manually retains the existing pending invitation flow.
- **Food & drinks:** the complete catalogue, including available, taken and inactive options; add/edit/deactivate descriptions and units; delete single/selected items and import a CSV. Units lock after their first contribution.
- **Church settings:** World Prayer Vision Life Healing Center only (`wpvlhc-aog`). The UI uses this existing church automatically when listing/creating people and loading reports. There are no multi-church selectors or create-church prompts; the existing API and other church records are unchanged. The default church must already exist from event setup; it can be edited/activated here.
- **Who is bringing what:** numbered rows for primary name, contribution, quantity, unit, catalogue description and guest notes. Only active attending contributors are shown; companions do not double quantities.
- **Exports:** `Export people` downloads the currently searched/filtered people as `christmas-social-people.csv`, including companion names, status and private invitation URLs. `Export food list` downloads the entire catalogue as `christmas-social-food-list.csv`, including unselected/inactive items. `Export contributions` downloads the visible commitment rows as `christmas-social-contributions.csv`, including descriptions and notes. All lists/exports have a leftmost row number starting at 1; filtering renumbers the view. CSVs are generated on the device from loaded data using UTF-8 BOM, quoted cells, CRLF and formula neutralization. Refresh before exporting to load newer registrations. No API changes or additional report endpoints are required.

Report times use `America/Guyana`. Data loads on sign-in, saving and Refresh; there is no live subscription. People loading follows all cursor pages for World Prayer Vision. Expired sessions return to sign-in and clear the management view.

## Delete people

Use **Delete** on a person, or check rows/**Select all shown people** and choose **Delete selected**. Select all follows the current search and reply filter, including all loaded cursor pages. Changing tabs/search/reply clears selection, so hidden people are not deleted accidentally. Each confirmation lists the chosen names and companions, displays a prominent warning, and requires typing the exact lowercase word **delete**; the server enforces it too.

Permanent deletion removes the primary registration, companion details and contributions. The guest's food slots are released for others; the catalogue and its active/inactive flags/unit locks are preserved. Headcounts, contributor totals and exports update after refresh. Old invitation links and replies return 404. Inactive/pending guests can be deleted too. Other people and anonymous gallery photos are unchanged; guests receive no automatic notification.

An original public registration retry cannot recreate a deleted person or retrieve their old receipt: the saved receipt is redacted to a private fingerprint/deletion marker, and an identical retry returns `410 REGISTRATION_DELETED`. A visitor can register again only by deliberately starting a new submission with a new request ID. Deactivation through Edit remains the reversible option.

The API accepts up to 50 people per atomic request. The UI processes groups of 10 to keep food-reservation cleanup bounded. Already completed groups stay deleted if a later request fails; **Retry deletion** continues with the remaining group, including safe retries when a response was lost after the deletion succeeded. Closing the dialog discards its in-memory progress; already removed IDs remain safe to retry. Deploy both the API and Hosting for this feature.

## Delete food items

Use **Delete** on one row, or check rows/**Select all food items** and use **Delete selected**. Every deletion has a confirmation window. Items that are selected or have contribution history show a prominent warning and require typing the exact lowercase word **delete**. The API independently requires this word whenever current guest choices would be removed, including if a guest selected an item after the page loaded.

Deletion permanently removes the catalogue item and its matching choices from all guest contributions, including inactive guests. Attendance, companions and other food choices are preserved. Reports, exports and totals update after refresh. Uncertain/repeated deletion requests are safe to retry. Bulk selections run in atomic groups of up to 50; if a later group fails, already completed groups remain deleted and Retry continues with the remaining rows. Guests are not automatically notified.

## Add food items from CSV

1. Open **Food & drinks → Import CSV** and download the template.
2. Fill one row per food slot. Required columns: `Name` and `Unit`. Optional: `Description` and `Active` (defaults to true).
3. Choose the file and review the preview. All rows must validate before anything is added.
4. Click **Add food items**. Progress is saved in this browser; reopening the import or refreshing lets you continue an interrupted batch safely.

```csv
Name,Unit,Description,Active
Baked chicken,servings,Bring cooked,true
Baked chicken,servings,Second separate slot,true
Fruit juice,bottles,Chilled,true
```

Imports add new slots; they do not replace existing items or transfer guest assignments. Repeated names create separate slots. `Active` accepts true/false, yes/no or 1/0. Food-list exports (`#,Item,Unit,Description,Status`) can also be imported: row numbers are ignored, Available/Taken become active **unclaimed new slots**, and Inactive stays inactive. Use either Active or Status, not both. Quoted commas, escaped quotes, multiline descriptions and UTF-8 BOM are supported.

Limits: 8 MB, 2,000 food rows, names 160 characters, units 40 and descriptions 500. The browser trims text and sends at most 10 rows per request. Stable request IDs prevent duplicates when retrying uncertain requests. Starting a **new** import with the same file intentionally creates more slots; resume the saved plan after interruptions. Changing files before import is allowed; discarding a partially completed plan leaves already saved slots in place.

## Build and hosting

```sh
npm run admin:build
```

For this React branding update, deploy Hosting after building (start from the repository root):

```sh
cd firebase
npx firebase deploy --only hosting --project wpvlhc-aog-2026
```

When shipping backend feature changes such as food deletion/import or people deletion, deploy the API and admin together after building:

```sh
cd firebase
npx firebase deploy --only functions:api,hosting --project wpvlhc-aog-2026
```

No migration, new secrets or reseeding are required. Do not reseed production to deploy this feature; the seed command recreates missing seeded food slots.

`dist/` is served through Firebase Hosting; `/v1/**` is rewritten to `api` before the SPA fallback. Keep administration and its API same-origin because the session cookie is SameSite=Strict. The Vite proxy follows this arrangement. Public endpoints accept requests without cookies.

The [OpenAPI contract](../../api-spec/openapi.json) defines all payloads. `src/api.js` handles cookies, required mutation headers, server errors and CSV downloads. Existing server CSV endpoints remain available independently. No session token is saved in browser storage.

## Isolated UI checks

These use a headless browser, sample API responses and a separate Vite server on port 5186. They do not require Firebase or write to a database. The proxy points to a closed local port, so unhandled API calls cannot reach production.

```sh
cd firebase/admin-dashboard
PLAYWRIGHT_CHANNEL=chrome npm run test:ui
```

Omit `PLAYWRIGHT_CHANNEL=chrome` when using an installed Playwright Chromium. The checks cover password visibility, plus-one headcounts, distinct food slots, available options, all people cursor pages, filtered/numbered exports, CSV escaping and formula neutralization, food/people deletion warnings, filtered selections, safe bulk retries, resumable CSV import, corrections and mobile layouts. Desktop/mobile screenshots are saved under ignored `test-results/`.

## Emulator browser smoke test

With the demo API/emulators running, the default `wpvlhc-aog` church seeded and local credentials configured, stop any existing Vite server on port 5173, then:

```sh
cd firebase/admin-dashboard
GALA_TEST_USERNAME=<local-user> GALA_TEST_PASSWORD=<local-password> PLAYWRIGHT_CHANNEL=chrome npm run test:e2e -- test/management.spec.js
```

Use local test credentials only. This smoke test starts its own Vite proxy pinned to the demo emulator, creates records under the existing default church, records food, checks personalised lookup/reporting/CSV downloads, and signs out. Test records remain only in the local emulator. Gallery tests require the separate full local gallery stack described in the gallery guide.

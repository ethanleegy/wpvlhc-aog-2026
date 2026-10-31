# Gala management dashboard

React + Vite management for WPVLHC AOG's December 2026 Christmas Gala. Uses the Node/Firestore backend in `../functions`; it contains no browser Firestore SDK, database credentials or stored admin password.

## Development

Configure and start the emulators as described in [Firebase setup](../README.md). From the repository root:

```sh
npm ci --prefix firebase/admin-dashboard
npm run admin:dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/v1` to `http://127.0.0.1:5001/demo-wpvlhc/us-central1/api`. For another local backend, copy `.env.example` to `.env.local` here and change `API_PROXY_TARGET`. Allow the browser origin in the backend's `ALLOWED_ORIGINS`.

## Views

- **Overview:** active invitations, attendance/reply counts, contributors, attendance by church and quantities per food item.
- **Invitations:** add/edit a person, greeting and church; search/filter; copy/open their URL; record/correct a reply and contributions; deactivate links.
- **Food & drinks:** add/edit/deactivate items, descriptions and units. Units lock after their first contribution.
- **Churches:** create/edit/deactivate congregations. Existing invitations stay visible when churches are inactive.
- **Contributions:** person, church, item, quantity/unit and notes from active, attending people.
- **Exports:** private guest/food CSVs, optionally restricted to the selected church.

Report times use `America/Guyana`. Data loads on sign-in, saving and Refresh; there is no live subscription. Invitation loading follows all cursor pages. Expired sessions return to sign-in and clear the management view.

## Build and hosting

```sh
npm run admin:build
```

`dist/` is served through Firebase Hosting; `/v1/**` is rewritten to `api` before the SPA fallback. Keep administration and its API same-origin because the session cookie is SameSite=Strict. The Vite proxy follows this arrangement. Public endpoints accept requests without cookies.

The [OpenAPI contract](../../api-spec/openapi.json) defines all payloads. `src/api.js` handles cookies, required mutation headers, server errors and downloads. No session token is saved in browser storage.

## Browser smoke test

With the demo emulators running and local credentials configured, stop any existing Vite server on port 5173, then:

```sh
cd firebase/admin-dashboard
npx playwright install chromium
GALA_TEST_USERNAME=<local-user> GALA_TEST_PASSWORD=<local-password> npm run test:e2e
```

Use local test credentials only. The test starts its own Vite proxy pinned to the demo emulator, creates demo records, records food, checks personalised lookup/reporting/CSV downloads, and signs out. It also captures desktop/mobile screenshots and rejects browser errors or mobile page overflow. To use installed Google Chrome instead of downloaded Chromium, set `PLAYWRIGHT_CHANNEL=chrome`. Test records remain only in the local emulator.

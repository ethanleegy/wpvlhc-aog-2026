# WPVLHC AOG · Christmas Social 2026

Personal invitations, RSVP and shared food planning for World Prayer Vision Life Healing Center Assembly of God, December 12, 2026.

The event name is **Christmas Social 2026**. Existing `gala-2026` data/storage namespaces, `gala-food-*` IDs and `wpvlhc-gala-*` hostnames/Cloudflare resources are retained as technical identifiers so existing records, images, links and retry receipts keep working. A branding change does not migrate these resources. Frontend source branding and browser-generated filenames are outside this backend/documentation update.

The public site remains Jekyll + Tailwind CSS. The backend and React management application live independently in `firebase/`, following [2026-tevin-and-natallia](https://github.com/TaricoHenry/2026-tevin-and-natallia) and [ashley-and-navin](https://github.com/TaricoHenry/ashley-and-navin).

## Project layout

```text
index.html, assets/, _includes/    Public Jekyll invitation site
firebase/
  functions/                     Node.js 24, Express 5, Joi, Functions v2
  admin-dashboard/               React + Vite management app
  scripts/                       Catalogue seeding and API validation
  firestore.rules                Server-only database access
  firestore.indexes.json         Query indexes and rate-limit TTL
  firebase.json                  Functions, Firestore, hosting, emulators
api-spec/
  APISPECS.md                    Frontend handoff and fetch examples
  openapi.json                   Complete OpenAPI 3.0.3 contract
```

## Features

- One primary attendee per invitation, with an optional named plus-one and a generated URL such as `https://your-public-site.example/?token=<code>`. Names and greetings come from Firestore; duplicate primary names receive distinct codes.
- Public shared-link registration accepts the attendee's name, optional companion name and food choices together. The frontend developer handles the prompts; the backend API preserves the existing personal invitation flow.
- Guests can save/revise attendance and food quantities/notes. Resubmitting replaces choices without duplicate contributions. Declining clears contributions.
- Protected React management for churches, invitations and food options, with link copying and response corrections on behalf of guests.
- Attendance by church, confirmed companion/total-person counts, food quantities and contributor counts, church filters and guest/food CSV exports including companion names.
- Joi validation, configured admin credentials, restricted origins, shared rate limits and server-only Firestore access.

## Frontend handoff

Start with [APISPECS](api-spec/APISPECS.md) and import [openapi.json](api-spec/openapi.json) into an OpenAPI viewer/API client.

**The public page's `assets/js/site.js` still has its original demo behaviour.** It reads `?name=` and shows local messages; it does not persist replies. The frontend developer must connect the forms to the new `?token=` flow, load names/menu IDs from the API, and display server results. The handoff covers this, including saving declined replies without a food form. The React management app is connected to the API already.

## Run locally

The React management UI defaults to World Prayer Vision Life Healing Center. It provides registration/plus-one headcounts, numbered lists and separate people, food-catalogue and contribution CSV exports. The existing API retains its church support; see the [dashboard guide](firebase/admin-dashboard/README.md) for the UI scope and count definitions.

Use Node.js 24 and Java 21+ for the Firestore emulator.

```sh
npm ci
npm ci --prefix firebase
npm ci --prefix firebase/functions
npm ci --prefix firebase/admin-dashboard
```

Follow [Firebase setup](firebase/README.md) for local secrets, emulators, the required event church and food-only catalogue seeding. Then:

```sh
npm run admin:dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/v1` to the Functions emulator.

For the public site, run these in separate terminals:

```sh
bundle install
bundle exec jekyll serve --livereload
```

```sh
npm run css:watch
```

Jekyll is configured on port `3000`; its output excludes Firebase and API-spec folders.

## Verify

```sh
npm test                                  # Unit tests and OpenAPI validation
npm --prefix firebase run test:integration # Actual Firestore emulator; demo project only
npm run admin:build                        # Production React build
npm run css:build                          # Public Tailwind build
bundle exec jekyll build                   # With Ruby/Bundler configured
```

Integration tests cover personal links, atomic updates, duplicate prevention, inactive records, church filters, pagination, exports, sessions, rate limits and database rules. They never use a production database.

## Deployment

For the gallery, follow the [production deployment runbook](api-spec/PROD_DEPLOYMENT_README.md). It explains the components, the Cloudflare $0 checks, matching secrets, all three releases, live acceptance and monthly renewal. A [printable guide](output/pdf/Gallery_Deployment_and_Readiness_Guide.pdf) accompanies it.

See [Firebase deployment/data model](firebase/README.md) and the [admin README](firebase/admin-dashboard/README.md). Confirm your target Firebase project, production URLs and admin secrets before deployment. Firebase Hosting serves the **management app**; the public Jekyll site keeps its existing hosting. The frontend handoff includes the deployed API URLs.

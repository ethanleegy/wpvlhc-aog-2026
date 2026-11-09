# Firebase backend and management

For the local gallery, see [the gallery client guide](../gallery-client/README.md). `npm run gallery:local` from the repository root starts isolated demo Firestore, the API, local R2/Worker, the guest uploader and management together. Gallery routes are disabled in existing deployments until explicitly configured; the Cloudflare $0 account review is a separate launch prerequisite.

The Christmas Social uses Firebase Functions v2 (`api`, `us-central1`) with Node.js 24, Express 5, Joi, the Firestore Admin SDK, bcrypt and JWT cookie sessions. The management frontend is React + Vite in `admin-dashboard/`. Routes are under `/v1`; see [APISPECS](../api-spec/APISPECS.md) and [OpenAPI](../api-spec/openapi.json).

The folder layout and versioned invitation endpoints follow the two reference applications. This application uses one named primary attendee per code with an optional named plus-one, permits response corrections, denies direct browser access to Firestore, and requires configured credentials without fallback passwords.

Public shared-link signup is supported by `POST /v1/registrations` with `{requestId,name,items,plusOne?,plusOneName?}`. It registers an attending guest under the existing active `wpvlhc-aog` church and reserves their food slots in one transaction. `plusOne:true` requires the companion's trimmed, nonempty name (maximum 160 characters). Identical UUIDv4 request retries return the original receipt; later edits use the existing guest-code endpoints. Non-attending shared-link visitors create no record. See the [registration contract](../api-spec/APISPECS.md#shared-link-public-registration) and [named plus-one rules](../api-spec/APISPECS.md#named-plus-one-contract). This is a backend update; the frontend developer must send/display the companion fields. No new secrets, environment variables, Firestore indexes or data migration are required. Deploy the API before sending the new fields; do not reseed existing production data for it.

## Local setup

Requirements: Node.js 24, npm and Java 21+. On macOS, ensure Java 21's `bin` directory is on `PATH`; setting only `JAVA_HOME` may leave an older `java` active. Check `node --version` and `java -version`.

From the repository root:

```sh
npm ci --prefix firebase
npm ci --prefix firebase/functions
npm ci --prefix firebase/admin-dashboard
cp firebase/functions/.env.example firebase/functions/.env.local
npm --prefix firebase/functions run password:hash
```

The last command prompts for a password without displaying it and prints its bcrypt hash. Create the gitignored file `firebase/functions/.secret.local`:

```dotenv
ADMIN_PASSWORD_HASH=<paste-the-full-bcrypt-hash>
ADMIN_JWT_SECRET=<paste-a-random-secret-of-at-least-32-bytes>
```

Generate a JWT secret locally with `node -e 'console.log(require("node:crypto").randomBytes(48).toString("hex"))'`. Keep passwords, secrets and service-account keys out of source control. Use separate local and production credentials.

```sh
npm run firebase:emulators
```

The `demo-wpvlhc` project is deliberately used locally. It cannot reach a live Firebase project's non-emulated services.

| Service | Address |
| --- | --- |
| Functions API | `http://127.0.0.1:5001/demo-wpvlhc/us-central1/api/v1` |
| Firestore | `127.0.0.1:8080` |
| Admin Hosting, after build | `http://127.0.0.1:5021` |
| Emulator UI | `http://127.0.0.1:4440` |
| React development server | `http://127.0.0.1:5173` |
| Public Jekyll site | `http://localhost:3000` |

In a second terminal, seed the current food catalogue only:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm --prefix firebase run seed
npm run admin:dev
```

Sign in with `ADMIN_USERNAME` from `.env.local` (example: `churchadmin`) and the password you hashed. The seed writes **only `FoodItems`**: no church records, sample people, invitation codes, contributions or `SeedData` state are created. The existing active `Churches/wpvlhc-aog` record is still required for public registration and the admin report; restore it separately if the entire database was cleared.

The client menu is in `scripts/seed-data.cjs`: **42 menu items and 87 independent contribution slots**. Every item has two slots except Water, which has five. Sponge cake and Ice cream are separate items; the pasted duplicate Cheese straw entry is included once as Cheese straws. Spelling has been cleaned up. Units are trays for meats/baked dishes/vegetable sides, gallon for rice/salads/soups/homemade drinks, dozen for pastries/eggs/roti/puri, cakes/tubs for dessert, packs for sweets/nuts/disposable supplies, and cases for packaged drinks/water. Each description explains one unit; the guest's quantity multiplies that unit.

Preview the complete quantities, units and descriptions without credentials or database access:

```sh
npm --prefix firebase run seed -- --dry-run
```

The seed uses stable per-item/slot IDs such as `gala-food-water-01` through `gala-food-water-05`. A transaction creates missing slots and preserves existing edits, claims, unit locks and timestamps. Repeating or retrying the command does not create duplicates. It does not clear an existing menu; remove old food records through the admin deletion controls before replacing a live catalogue. Only missing seed records are added, so changing the seed file does not overwrite an already seeded item.

For the cleared production food catalogue, with Application Default Credentials already configured:

```sh
unset FIRESTORE_EMULATOR_HOST
npm --prefix firebase run seed -- --production --project wpvlhc-aog-2026
```

If authentication is needed, run `gcloud auth application-default login` first. Production mode requires an explicit real project and rejects an active emulator setting. Local mode requires both a demo project and an emulator. No app deployment is needed to seed data.

Emulator data is temporary unless you use Firebase CLI `--export-on-exit` / `--import`. Keep data exports outside the public Jekyll output and source control.

## Configuration

| Setting | Purpose |
| --- | --- |
| `ADMIN_USERNAME` | One shared management username in `.env.<project-id>` |
| `ADMIN_PASSWORD_HASH` | bcrypt hash through Firebase Secret Manager |
| `ADMIN_JWT_SECRET` | Random signing secret, at least 32 bytes, through Secret Manager |
| `PUBLIC_SITE_URL` | Public invitation root/subpath; generated links append `?token=` |
| `ALLOWED_ORIGINS` | Comma-separated exact public/admin origins; include the admin Hosting origin |
| `LOCAL_DEVELOPMENT` | `true` only with the emulator, enabling local non-Secure cookies; `false` in production |

Credentials, PUBLIC_SITE_URL and ALLOWED_ORIGINS are required. In production, `PUBLIC_SITE_URL` and non-loopback origins must use HTTPS. Explicitly listed HTTP origins on `localhost`, `127.0.0.1` or `[::1]` are allowed for frontend development; keep `LOCAL_DEVELOPMENT=false` so production cookies remain Secure. Origins cannot have paths, trailing slashes or wildcards. `PUBLIC_SITE_URL` cannot contain a query/fragment. Configuration is checked at request time so Firebase can discover exports before secret injection. `/v1/ready` checks liveness, not credentials/database readiness.

## Firestore model

| Collection | Document ID | Contents |
| --- | --- | --- |
| `Churches` | Server ID; required event record: `wpvlhc-aog` | `name`, `active`, `createdAt`, `updatedAt` |
| `InvitedGuests` | Server-generated 24-character lowercase hexadecimal invitation code | `name`, `personalizedName`, `churchId`, `active`, `rsvp` (`pending`, `yes`, `no`), `plusOne`, `plusOneName`, optional `registrationSource:"public"`, `respondedAt`, `createdAt`, `updatedAt` |
| `FoodItems` | Server ID; current seeds: `gala-food-water-01` etc. | `name`, `description`, `unit`, `active`, `hasContributions`, `claimedBy` (guest code or null), `createdAt`, `updatedAt` |
| `FoodContributions` | Same code as the person | `guestId`, `items: [{foodItemId, name, unit, quantity, notes}]`, `updatedAt` |
| `PublicRegistrationRequests` | SHA-256 of event and canonical private UUIDv4 request ID | Input fingerprint, original registration receipt (including guest code), `createdAt`; after permanent person deletion only `fingerprint` and `deletedAt` remain, preventing old retries from restoring or revealing deleted records |
| `FoodImportRequests` | SHA-256 of event and private UUIDv4 batch ID | Food-input fingerprint, original imported slot IDs/count, `createdAt`; server-only retry receipts |
| `RateLimits` | SHA-256 digest of a limit key | `count`, `expiresAt` (TTL field) |
| `SeedData` | Legacy `gala-2026-members` | Historical sample-seed state, if present; the food-only seed does not read or write it |

Timestamps are Firestore server timestamps internally and ISO 8601 UTC strings in JSON. `token` and `uniqueUrl` are derived response fields; clients cannot choose them. Query tokens are bearer credentials for the person's RSVP. Do not log full invitation URLs or send them to analytics. The public layout includes a no-referrer policy.

RSVP and contributions are replaced in one transaction. Declining requires an empty `items` array; an attending person may also bring nothing. A person may select at most 30 distinct items, with integer quantities of 1–10,000 and notes of at most 500 characters per item. An item's unit is permanently locked after its first contribution, preventing mixed-unit reports. Inactive items may remain in an existing commitment at the same/reduced quantity.

Companion fields update in the same transaction as the RSVP and food choices. `plusOne:true` requires `plusOneName`; `plusOne:false` clears it. Omit both on an attending update to preserve the saved companion, including for older clients. Declining clears both fields and rejects an explicit plus-one. Admin create/PATCH supports the same pair; a declined guest must first be marked attending through the admin reply endpoint before a companion can be added. Old records and receipts return `plusOne:false, plusOneName:""`. No-companion request fingerprints remain compatible with pre-upgrade registration retries. The companion stays on the primary record without a separate code, food claim or gallery identity.

Each food record is a single-person slot. Reserving it atomically removes it from the public menu; another person receives `409 FOOD_ITEM_TAKEN`. Removing it from a reply or declining releases it. Owners can revise their quantities without reserving it twice. Deactivating an invitation retains its recorded commitments; clear its reply if you also want to release the slots.

Guests/churches can be deactivated using `PATCH {"active":false}`. People also support permanent single/bulk deletion with mandatory `confirmation:"delete"`, contribution removal and food-slot release; church deletion is unavailable. Food items support explicit single/bulk permanent deletion with choice cleanup; selected items require typing `delete` in the UI and sending that confirmation to the API. Inactive guests return 410 publicly and are excluded from reports; reactivation restores their recorded responses/contributions. Inactive churches keep existing invitations and reports but cannot receive new or reassigned guests. Inactive food options disappear from the public catalogue and retain commitments. Management can correct responses on inactive guest records.

## Reports and access

Reports read a consistent Firestore snapshot. Existing RSVP counts cover active primary guest records. Overall/per-church `plusOnes` counts companions of active Yes replies; `attendingPeople=yes+plusOnes` is the confirmed headcount. Pending, declined and inactive records add no confirmed companions. Contributor counts and food quantities are unchanged and grouped by the primary person's current church. CSVs use UTF-8 with BOM, quotes and CRLF and neutralize spreadsheet formulas. Guest exports contain private invitation URLs and append `Plus one` and `Plus-one name` columns. The React dashboard uses `attendingPeople` for People coming and displays companion names; API `yes` continues to count primary registrations.

Admin sessions use an 8-hour `__session` HttpOnly cookie, SameSite=Strict, Secure in production. Hosting rewrites `/v1/**` to the function, keeping administration same-origin. Every admin mutation, including login/logout, requires JSON and `X-Admin-Request: true`. Logout clears the browser cookie; copied JWTs expire naturally. Rotate `ADMIN_JWT_SECRET` and redeploy to invalidate all sessions.

Login is limited to 10 attempts per observed client IP per 15 minutes; public replies to 60 per invitation per 15 minutes. Public registration permits 500 validated attempts per observed IP per 15 minutes, including successful replays, to accommodate shared event Wi-Fi. Transactional Firestore counters survive cold starts and multiple instances. Expired counters reset before TTL cleanup. Multiple users may share an observed proxy IP; the application does not trust arbitrary forwarded headers. Registration IDs are private retry credentials, not name-based person deduplication; a new ID creates a distinct person. Guests created through public registration carry `registrationSource:"public"` and are included in the existing active-guest counts, reports and CSVs.

Firestore rules deny all direct client reads/writes. Only the server Admin SDK accesses the database. There is no browser Firestore dependency/configuration. This is a single-event, shared-admin application at church event scale; reporting reads the event's collections. Separate per-church staff accounts and multiple events are outside this implementation.

## Tests

```sh
npm --prefix firebase/functions test
npm --prefix firebase run spec:check
npm --prefix firebase run test:integration
npm --prefix firebase/admin-dashboard run build
```

The integration runner starts an isolated Firestore emulator with these rules and runs HTTP tests against Express and the actual Firestore SDK. It refuses non-`demo-` projects, clears demo data, then shuts down. Run it separately from development emulators because they share ports.

## Production deployment

For the gallery's full Cloudflare + Firebase + public-site sequence, use the [production deployment runbook](../api-spec/PROD_DEPLOYMENT_README.md). The steps below cover the existing backend and management deployment.

1. Confirm your Firebase project has a Firestore database and billing enabled for Functions. This event uses `wpvlhc-aog-2026`; pass your intended project explicitly when deploying or seeding.
2. From `firebase/`, run `npx firebase login`, then `npx firebase use --add` to select your project as default. Alternatively pass `--project <project-id>` explicitly.
3. Create `functions/.env.<project-id>` with real `ADMIN_USERNAME`, `PUBLIC_SITE_URL`, HTTPS `ALLOWED_ORIGINS`, and `LOCAL_DEVELOPMENT=false`. Include both the admin Hosting and public Jekyll origins. Keep local settings in `.env.local`.
4. Set secrets interactively, from `firebase/`. Run each command individually:

   ```sh
   npm --prefix functions run password:hash
   npx firebase functions:secrets:set ADMIN_PASSWORD_HASH --project wpvlhc-aog-2026
   node -e 'console.log(require("node:crypto").randomBytes(48).toString("hex"))'
   npx firebase functions:secrets:set ADMIN_JWT_SECRET --project wpvlhc-aog-2026
   ```

   Enter your chosen admin password in the hash helper, then paste only its complete `$2b$...` output at the `ADMIN_PASSWORD_HASH` prompt. Paste the generated random string at the `ADMIN_JWT_SECRET` prompt; it must contain at least 32 bytes. Use the original chosen password in the login form. Secret changes take effect after redeploying the function. No plaintext password belongs in environment files.

5. From `firebase/`, run `npm run deploy -- --project <project-id>`. It validates the spec, runs backend unit tests, builds the dashboard, then deploys functions, rules/indexes and admin Hosting. Run integration tests separately before deploying.
6. With Google Application Default Credentials configured and the event church already set up, seed missing food records explicitly from the repository root:

   ```sh
   npm --prefix firebase run seed -- --production --project <project-id>
   ```

   If your terminal is already inside `firebase/`, use `npm run seed -- --production --project wpvlhc-aog-2026` instead. For local production seeding, first run `gcloud auth application-default login` with an account that can access the project.

   The script refuses live writes without explicit production intent and a real project ID. `firebase login` alone does not configure Node's Application Default Credentials. Existing records are preserved. Never place credentials in the public site.

7. Verify deployed liveness, sign-in and an invitation/response/report. Give the frontend developer the API base URL and a test invitation code.

Hosting serves the management app independently of Jekyll. It replaces existing Hosting content on the selected site; use a dedicated project/site if you host something there already.

Official references: [Functions runtime/deployment](https://firebase.google.com/docs/functions/manage-functions), [Hosting function rewrites](https://firebase.google.com/docs/hosting/functions), [Hosting session cookies](https://firebase.google.com/docs/hosting/manage-cache), [Joi API](https://joi.dev/api/).

## Dependency audit

At implementation, the backend and React dependency audits report zero vulnerabilities. The separately installed Firebase CLI development tooling reports 15 moderate upstream advisories. Compatible audit fixes have been applied; the remaining CLI findings require upstream updates. The CLI is not a deployed function/dashboard dependency. Recheck with `npm audit --prefix firebase/functions`, `npm audit --prefix firebase/admin-dashboard` and `npm audit --prefix firebase` when updating dependencies.

## Food catalogue bulk operations

Admin API version 1.4.0 supports `DELETE /food-items/{id}`, `POST /food-items/bulk-delete` (up to 50 IDs) and `POST /food-items/import` (up to 10 create payloads with a private UUIDv4 per batch). Deletion scans current contribution records in the transaction, removes matching choices including inactive/legacy references, and preserves RSVP/companion/other choices. Selected choices require `confirmation:"delete"`; missing IDs are safe to retry. Import receipts prevent duplicate slots after uncertain requests and do not recreate slots deleted later. The UI parses/previews up to 2,000 CSV rows locally and saves progress for resuming. See the [admin guide](admin-dashboard/README.md) for CSV columns and warnings and [API handoff](../api-spec/APISPECS.md#food-import-and-permanent-deletion) for the contract. Deploy both `functions:api` and Hosting; do not reseed production for this change.

## Permanent people deletion

API version 1.5.0 adds `DELETE /guests/{id}` and `POST /guests/bulk-delete` (up to 50 guest codes). The admin UI requires typing **delete** and processes groups of 10. Each transaction removes guest/companion/contribution records, releases claimed food slots (retaining active flags and unit locks), and redacts matching public-registration receipts to fingerprint/deletedAt tombstones. Existing invitation links/replies return 404; identical original registration retries return 410 REGISTRATION_DELETED and cannot recreate the deleted person. Missing IDs can be retried safely, including orphan cleanup. Targeted single-field queries use existing automatic indexes; no new index, secret or migration is required. Deploy `functions:api` and Hosting together. See the [admin guide](admin-dashboard/README.md#delete-people) and [API contract](../api-spec/APISPECS.md#permanent-people-deletion).

# Firebase backend and management

The gala uses Firebase Functions v2 (`api`, `us-central1`) with Node.js 24, Express 5, Joi, the Firestore Admin SDK, bcrypt and JWT cookie sessions. The management frontend is React + Vite in `admin-dashboard/`. Routes are under `/v1`; see [APISPECS](../api-spec/APISPECS.md) and [OpenAPI](../api-spec/openapi.json).

The folder layout and versioned invitation endpoints follow the two reference applications. This application uses one person per code, permits response corrections, denies direct browser access to Firestore, and requires configured credentials without fallback passwords.

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

In a second terminal, seed the initial church and the 12 menu items already in `_data/food_items.yml`:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm --prefix firebase run seed
npm run admin:dev
```

Sign in with `ADMIN_USERNAME` from `.env.local` (example: `churchadmin`) and the password you hashed. Create an invitation and copy its generated link. Seeding creates no people or fake RSVPs and preserves every existing record if rerun. Seed food IDs are `food-01` through `food-12`; the initial unit is `servings`, which management can adjust before an item receives its first contribution.

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

Credentials, PUBLIC_SITE_URL and ALLOWED_ORIGINS are required. Production URLs must use HTTPS. Origins cannot have paths, trailing slashes or wildcards. `PUBLIC_SITE_URL` cannot contain a query/fragment. Configuration is checked at request time so Firebase can discover exports before secret injection. `/v1/ready` checks liveness, not credentials/database readiness.

## Firestore model

| Collection | Document ID | Contents |
| --- | --- | --- |
| `Churches` | Server ID; seed: `wpvlhc-aog` | `name`, `active`, `createdAt`, `updatedAt` |
| `InvitedGuests` | Server-generated 24-character lowercase hexadecimal invitation code | `name`, `personalizedName`, `churchId`, `active`, `rsvp` (`pending`, `yes`, `no`), `respondedAt`, `createdAt`, `updatedAt` |
| `FoodItems` | Server ID; seeds: `food-01` etc. | `name`, `description`, `unit`, `active`, `hasContributions`, `createdAt`, `updatedAt` |
| `FoodContributions` | Same code as the person | `guestId`, `items: [{foodItemId, name, unit, quantity, notes}]`, `updatedAt` |
| `RateLimits` | SHA-256 digest of a limit key | `count`, `expiresAt` (TTL field) |

Timestamps are Firestore server timestamps internally and ISO 8601 UTC strings in JSON. `token` and `uniqueUrl` are derived response fields; clients cannot choose them. Query tokens are bearer credentials for the person's RSVP. Do not log full invitation URLs or send them to analytics. The public layout includes a no-referrer policy.

RSVP and contributions are replaced in one transaction. Declining requires an empty `items` array; an attending person may also bring nothing. A person may select at most 30 distinct items, with integer quantities of 1–10,000 and notes of at most 500 characters per item. An item's unit is permanently locked after its first contribution, preventing mixed-unit reports. Inactive items may remain in an existing commitment at the same/reduced quantity.

Use `PATCH {"active":false}` instead of deletion. Inactive guests return 410 publicly and are excluded from reports; reactivation restores their recorded responses/contributions. Inactive churches keep existing invitations and reports but cannot receive new or reassigned guests. Inactive food options disappear from the public catalogue and retain commitments. Management can correct responses on inactive guest records.

## Reports and access

Reports read a consistent Firestore snapshot. They count active invitations and contributions from attending people, grouped by the person's current church. Quantities retain each food item's unit. CSVs use UTF-8 with BOM, quotes and CRLF and neutralize spreadsheet formulas. Guest exports contain private invitation URLs.

Admin sessions use an 8-hour `__session` HttpOnly cookie, SameSite=Strict, Secure in production. Hosting rewrites `/v1/**` to the function, keeping administration same-origin. Every admin mutation, including login/logout, requires JSON and `X-Admin-Request: true`. Logout clears the browser cookie; copied JWTs expire naturally. Rotate `ADMIN_JWT_SECRET` and redeploy to invalidate all sessions.

Login is limited to 10 attempts per observed client IP per 15 minutes; public replies to 60 per invitation per 15 minutes. Transactional Firestore counters survive cold starts and multiple instances. Expired counters reset before TTL cleanup. Multiple users may share an observed proxy IP; the application does not trust arbitrary forwarded headers.

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

1. Select your Firebase project with a Firestore database and billing enabled for Functions. Choose the database location deliberately; no production project is embedded here.
2. From `firebase/`, run `npx firebase login`, then `npx firebase use --add` to select your project as default. Alternatively pass `--project <project-id>` explicitly.
3. Create `functions/.env.<project-id>` with real `ADMIN_USERNAME`, `PUBLIC_SITE_URL`, HTTPS `ALLOWED_ORIGINS`, and `LOCAL_DEVELOPMENT=false`. Include both the admin Hosting and public Jekyll origins. Keep local settings in `.env.local`.
4. Set secrets interactively, from `firebase/`:

   ```sh
   npx firebase functions:secrets:set ADMIN_PASSWORD_HASH --project <project-id>
   npx firebase functions:secrets:set ADMIN_JWT_SECRET --project <project-id>
   ```

   Generate the hash with `npm --prefix functions run password:hash`. No plaintext password belongs in environment files.

5. From `firebase/`, run `npm run deploy -- --project <project-id>`. It validates the spec, runs backend unit tests, builds the dashboard, then deploys functions, rules/indexes and admin Hosting. Run integration tests separately before deploying.
6. With Google Application Default Credentials configured, seed missing records explicitly from the repository root:

   ```sh
   npm --prefix firebase run seed -- --production --project <project-id>
   ```

   The script refuses live writes without explicit production intent and a real project ID. `firebase login` alone does not configure Node's Application Default Credentials. Existing records are preserved. Never place credentials in the public site.

7. Verify deployed liveness, sign-in and an invitation/response/report. Give the frontend developer the API base URL and a test invitation code.

Hosting serves the management app independently of Jekyll. It replaces existing Hosting content on the selected site; use a dedicated project/site if you host something there already.

Official references: [Functions runtime/deployment](https://firebase.google.com/docs/functions/manage-functions), [Hosting function rewrites](https://firebase.google.com/docs/hosting/functions), [Hosting session cookies](https://firebase.google.com/docs/hosting/manage-cache), [Joi API](https://joi.dev/api/).

## Dependency audit

At implementation, the backend and React dependency audits report zero vulnerabilities. The separately installed Firebase CLI development tooling reports 15 moderate upstream advisories. Compatible audit fixes have been applied; the remaining CLI findings require upstream updates. The CLI is not a deployed function/dashboard dependency. Recheck with `npm audit --prefix firebase/functions`, `npm audit --prefix firebase/admin-dashboard` and `npm audit --prefix firebase` when updating dependencies.

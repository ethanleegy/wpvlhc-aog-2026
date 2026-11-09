# Christmas Social gallery production deployment

Updated 5 November 2026. This is the operator runbook for the gallery. Follow the sections in order and run commands from the directory stated above each block. The examples use the existing `wpvlhc-aog-2026` Firebase project and public Christmas Social domain; confirm the actual targets before deploying.

The two review findings have been fixed: guest authorization now restores/renews the session on share, retry and resume; expired admin thumbnails request a fresh link, with at most one automatic refresh per photo per minute. Production account configuration and live acceptance are separate release steps. No production deployment was performed while preparing this guide.

Printable companion: [deployment and readiness PDF](../output/pdf/Gallery_Deployment_and_Readiness_Guide.pdf).

The event is named **Christmas Social**. Existing hostnames, Worker/bucket names and `gala-2026` storage/database keys below retain their deployed spelling; they are not display branding. Frontend source and the historical printable PDF are separate from this documentation/backend naming update.

## Verified local result

On 5 November 2026, **36 tests passed**: 10 backend unit tests, 5 guest session/queue regressions, 12 Firestore integration tests, 5 Worker/deployment-guard tests and 4 headless browser tests. The browser run included the HEIC sample and both reported bug regressions. All 43 API operations match the backend contract; guest, admin, Worker and Jekyll builds pass. The public artifact was checked for the gallery assets and exclusion of private/review folders.

This is ready for a controlled production deployment once the account/resources/secrets below are configured. Public event launch still requires verified Cloudflare headroom, a complete publishing process and live phone/batch acceptance. There is no known remaining blocker from the two reported bugs.

## The little breakdown

| Part | What it does | Where it lives |
| --- | --- | --- |
| Guest page | Camera/library, preview, Share, gallery browsing | Existing public Jekyll site, `/gallery/upload/` |
| Management | QR, upload switches, bulk uploads, approval, hide/show | Firebase Hosting, React management app |
| Backend | Sessions, permissions, structural photo checks, visibility and quotas | Firebase Functions + Firestore |
| Image gateway | Accepts bounded signed uploads and serves authorized images | Cloudflare Worker, Workers Free |
| Private storage | Temporary uploads and retained compressed copies | Private R2 Standard bucket |
| Published storage | Copies approved for gallery display | A second private R2 Standard bucket |

Your phone or admin computer compresses every photo before transfer. The server does not encode images. The original stays on the device; the gallery stores only a thumbnail and a display copy. Both buckets are private, including the one named “published.” Public viewing still goes through the Worker.

Automatic publication after validation is the default. Prior approval is optional. Admins can bulk hide/show, and hiding retains the management copy. Existing viewing links/cached files can remain usable for up to five minutes after hiding; downloaded files cannot be recalled.

There are **three separate releases**: the Cloudflare Worker, Firebase backend/management, and public Jekyll site. Deploying only the Worker does not deliver the whole gallery.

## 1. Prepare and check locally

Use Node.js 24, npm, Java 21+ for the emulator, and Ruby/Bundler for Jekyll. From the repository root:

```sh
npm ci
npm ci --prefix firebase
npm ci --prefix firebase/functions
npm ci --prefix firebase/admin-dashboard
npm ci --prefix gallery-client
npm ci --prefix cloudflare/gallery-worker
bundle install
```

Run the checks before releasing:

```sh
npm test
npm --prefix firebase run test:integration
npm --prefix cloudflare/gallery-worker test
npm run gallery:build
bundle exec jekyll build
npm run gallery:test:e2e
```

The integration command starts a demo Firestore emulator and shuts it down afterward. Stop your own development emulator first if it occupies the same ports; do not stop an unrelated service. The browser suite runs isolated headless Chrome, not your open browser profile. The optional HEIC case needs `.gallery-local/example.heic` or `GALLERY_HEIC_FIXTURE`; otherwise it skips. Large lazy HEIC bundle notices and existing Minima Sass deprecation messages are warnings.

For manual local checking, run `npm run gallery:local`. Guest page: `http://127.0.0.1:5174/`; management: `http://127.0.0.1:5173/`; demo login: `localadmin` / `local-gallery-only`. These credentials are local only. Stop with Ctrl+C. Demo Firestore is temporary by default; local R2 persists under `.gallery-local/`.

## 2. Verify the Cloudflare $0 conditions

The gallery is designed to pause rather than upgrade when its limits are reached. A local pass does **not** verify the actual account allowance or guarantee an invoice.

| Resource | Official included allowance | Gallery budget / control |
| --- | --- | --- |
| R2 Standard storage | 10 GB-month per month | 6 GB total gallery physical/reserved space |
| R2 Class A operations | 1 million per month | 100,000 counted write attempts per billing period |
| R2 Class B operations | 10 million per month | Reserve 3.3 million; backend reads separately capped at 100,000 |
| Workers Free | 100,000 requests per UTC day; 10 ms CPU per invocation | Keep Free; at most one R2 read per Worker request; fail closed at exhaustion |

Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

Review the entire account. Protect the gallery allowance from every other bucket, Worker, credential and user. The read reservation covers up to 32 UTC daily request buckets across a billing interval of at most 31 days, plus backend reads. R2 storage is measured using daily peaks across the month: include historical usage and future allocations, not just today's object total. The two buckets share the account allowance.

Keep Workers Free and R2 Standard. Do not enable paid Workers, Images, Cache Reserve or a lifecycle transition to Infrequent Access. Disable direct public R2 access. For a custom Worker route, select **fail closed** so exhausted requests cannot bypass the gateway.

Firebase remains separate. Cloud Functions deployment requires the [Blaze plan](https://firebase.google.com/docs/functions/get-started); this architecture does not guarantee an overall $0 Firebase/hosting bill. Check that account's usage separately.

## 3. Create the Cloudflare resources

In the intended Cloudflare account:

1. Confirm the Workers plan is Free.
2. Create Standard buckets `wpvlhc-gala-2026-private` and `wpvlhc-gala-2026-published`.
3. On **both**, keep r2.dev/public access and bucket custom domains disabled. Buckets are [private by default](https://developers.cloudflare.com/r2/buckets/create-buckets/).
4. On the private bucket, add a backup deletion lifecycle restricted to `staging/gala-2026/`, for example after one day. Do not apply it to `retained/` or `published/`, and do not change storage class. [Lifecycle deletion is delayed](https://developers.cloudflare.com/r2/buckets/object-lifecycles/); it does not itself reconcile Firestore reservations.
5. Create a Turnstile Free widget for `wpvlhc-gala-2026.ivory-gy.com` after confirming that is the actual hostname. Record its public site key and private secret key. The client already sends action `gallery-upload`; Firebase verifies that action and the exact hostname. See [Turnstile setup](https://developers.cloudflare.com/turnstile/get-started/).
6. Keep the Worker's `*/15 * * * *` maintenance trigger enabled. It calls a protected, bounded Firebase operation.

The source bindings are in `cloudflare/gallery-worker/wrangler.jsonc`. If you choose different bucket names, update those bindings before generating the production configuration. Keep the committed development configuration separate from the generated production configuration.

## 4. Record the actual account review

Create the ignored `.gallery-local/cloudflare-review.json` at the repository root. Replace every placeholder and **replace all three example zeros with verified non-gallery usage and protected allocations**. Zero is valid only when verified.

```json
{
  "accountId": "<reviewed 32-character hexadecimal account ID>",
  "workersPlan": "free",
  "r2StorageClass": "Standard",
  "privateBucketsVerified": true,
  "sharedAllowanceProtected": true,
  "checkedAt": "<current UTC ISO timestamp>",
  "billingStart": "<actual UTC billing-period start>",
  "billingEnd": "<actual UTC billing-period end>",
  "otherStorageBytes": 0,
  "otherClassAWrites": 0,
  "otherClassBReads": 0,
  "apiBase": "https://wpvlhc-aog-2026.web.app/v1",
  "allowedOrigins": [
    "https://wpvlhc-gala-2026.ivory-gy.com",
    "https://wpvlhc-aog-2026.web.app"
  ]
}
```

Origins must be exact HTTPS origins, with no trailing slash, path or wildcard. Include every actual public/admin origin used. The API base must end in `/v1`. Add another admin Hosting origin only if it is actually used.

The deployment wrapper rejects reviews over 24 hours old, unsupported plans/classes, expired periods, or insufficient shared headroom. It **validates supplied facts; it does not fetch live billing or enforce other users' behavior**. If the account cannot preserve the allowance, stop here.

## 5. Prepare secrets and keep the first launch closed

Create three independent random gallery secrets, each at least 32 bytes. For example, run this individually three times in a trusted local terminal and store each result in a password manager:

```sh
node -e 'console.log(require("node:crypto").randomBytes(48).toString("hex"))'
```

| Firebase Secret Manager | Worker secret | Relationship |
| --- | --- | --- |
| `GALLERY_TICKET_SECRET` | `TICKET_SECRET` | Exactly the same value |
| `GALLERY_INTERNAL_SECRET` | `INTERNAL_SECRET` | Exactly the same value |
| `GALLERY_CLAIM_SECRET` | `CLAIM_SECRET` | Exactly the same value |
| `GALLERY_TURNSTILE_SECRET` | None | Production Turnstile secret; Firebase only |

Keep existing `ADMIN_PASSWORD_HASH` and `ADMIN_JWT_SECRET` separate. Do not store any of these in Git, the public bundle, the review JSON, or the non-secret environment file.

Before enabling the production gallery, create `GallerySettings/gala-2026` in the intended Firestore database, or update only the appropriate fields if it already exists:

| Field | Type | Initial value |
| --- | --- | --- |
| `guestUploadsOpen` | boolean | `false` |
| `adminUploadsOpen` | boolean | `true` |
| `requireApproval` | boolean | `false` |
| `version` | number | `1` for a new document; preserve it otherwise |

Use the Firebase console as an authorized project operator. Preserve existing photos, settings and invitation data. Without an explicit setting, guest uploads default to open once the gallery is enabled.

## 6. Deploy the reviewed Worker

Working directory: `cloudflare/gallery-worker/`.

```sh
npx wrangler login
npx wrangler whoami
node scripts/deploy.mjs --dry-run
npm run deploy
```

Confirm the account shown by `whoami` matches the review. Use the wrapper for production. A direct deploy of the development config has a localhost backend and an empty cost expiry. The normal `gallery:build` Worker dry run only proves bundling; it is not the reviewed production dry run.

The wrapper writes `.gallery-local/wrangler.production.json`, then deploys the reviewed account, origins, API URL and cost expiry. Record the returned HTTPS Worker URL.

For the first deployment, install the matching secrets next, entering each value interactively:

```sh
npx wrangler secret put TICKET_SECRET --config ../../.gallery-local/wrangler.production.json
npx wrangler secret put INTERNAL_SECRET --config ../../.gallery-local/wrangler.production.json
npx wrangler secret put CLAIM_SECRET --config ../../.gallery-local/wrangler.production.json
```

Uploads cannot work until the matching secrets and Firebase configuration are present. A `/ready` response is only liveness. Secret commands are documented by [Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/).

## 7. Configure and deploy Firebase

Confirm the existing Firestore database and intended Hosting site. The default project is `wpvlhc-aog-2026`. Hosting deployment replaces the management app on the selected site; retain the existing intended target.

Create/update `firebase/functions/.env.wpvlhc-aog-2026` with non-secret production values:

```dotenv
ADMIN_USERNAME=<existing production admin username>
PUBLIC_SITE_URL=https://wpvlhc-gala-2026.ivory-gy.com/
ALLOWED_ORIGINS=https://wpvlhc-gala-2026.ivory-gy.com,https://wpvlhc-aog-2026.web.app
LOCAL_DEVELOPMENT=false
GALLERY_ENABLED=true
GALLERY_WORKER_URL=https://<returned-worker-hostname>
GALLERY_BILLING_START=<same UTC period start as review>
GALLERY_BILLING_END=<same UTC period end as review>
GALLERY_FREE_PLAN_VERIFIED=true
GALLERY_TURNSTILE_SITE_KEY=<production Turnstile public site key>
```

Use the Worker origin only: no path, query or trailing resource name. The public-site URL should be the site root. The API uses its hostname to validate Turnstile. If changing projects or domains, also update the frontend API target and every relevant origin.

Working directory: `firebase/`. Authenticate yourself and set each secret separately:

```sh
npx firebase login
npx firebase functions:secrets:set GALLERY_TICKET_SECRET --project wpvlhc-aog-2026
npx firebase functions:secrets:set GALLERY_INTERNAL_SECRET --project wpvlhc-aog-2026
npx firebase functions:secrets:set GALLERY_CLAIM_SECRET --project wpvlhc-aog-2026
npx firebase functions:secrets:set GALLERY_TURNSTILE_SECRET --project wpvlhc-aog-2026
```

For an existing production system, preserve its admin secrets. If provisioning a new project, follow [Firebase credential setup](../firebase/README.md#production-deployment) to create `ADMIN_PASSWORD_HASH` and `ADMIN_JWT_SECRET` as well; never use the local demo password.

```sh
npm run deploy -- --project wpvlhc-aog-2026
```

This validates the contract, runs backend unit tests, builds management, and deploys Functions, Firestore rules/indexes and management Hosting. Integration and browser tests must have passed separately. `GALLERY_ENABLED=true` must be set before deployment so the function binds its gallery secrets.

Wait for gallery indexes to finish building in Firestore before smoke testing queries. Secret changes require redeployment. Do not run production seeding again merely to enable the gallery; existing invitations are independent. `/v1/ready` does not validate gallery secrets, Turnstile, indexes or storage.

## 8. Build and publish the public site

The production guest page defaults to `https://wpvlhc-aog-2026.web.app/v1`. If using a different API, set `data-api-base` on the `#gallery-app` element in `gallery/upload/index.html`, then rebuild. Do not point production at the local API.

Confirm `CNAME`, DNS, HTTPS and Jekyll's production `url`, `domain` and `baseurl`. `_config.yml` currently contains the old GitHub URL; update the production URL metadata for the real Christmas Social domain before publishing. The gallery asset build assumes root hosting at `/assets/gallery/`; a subpath needs matching build/template configuration.

Working directory: repository root.

```sh
npm run css:build
npm --prefix gallery-client run build
bundle exec jekyll build
```

Publish **the complete `_site/` output** using the public site's existing host. Confirm that it includes:

```text
gallery/upload/index.html
assets/gallery/guest.js
assets/gallery/guest.css
assets/gallery/assets/   (compression worker and all lazy chunks)
```

The source `assets/gallery/` output is ignored by Git. A plain Jekyll-only branch build will not run the npm gallery build. No public publishing workflow is installed in this snapshot; configure the host build or use the optional Pages template below before launch.

Never upload the repository root as the public artifact. `_site/` must exclude backend source, credentials, `.gallery-local/`, `api-spec/`, `output/`, `tmp/` and `test-results/`. The existing exclusions cover these folders.

### Optional GitHub Pages workflow template

If the existing public host is GitHub Pages, select **Settings -> Pages -> Build and deployment -> GitHub Actions**. The following is a manual-trigger example for a future `.github/workflows/public-site.yml`. It is documentation only; it has not been installed or enabled by these fixes. It publishes only the public site, not Firebase or the image Worker. Verify the host/account allowance separately.

```yaml
name: Publish public site
on:
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: public-pages
  cancel-in-progress: false
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v6
      - uses: actions/configure-pages@v5
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
      - uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true
      - name: Build the complete public site
        run: |
          npm ci
          npm ci --prefix gallery-client
          npm run css:build
          npm --prefix gallery-client run build
          bundle exec jekyll build
          test -f _site/gallery/upload/index.html
          test -f _site/assets/gallery/guest.js
          test -f _site/assets/gallery/guest.css
          test ! -d _site/firebase
          test ! -d _site/.gallery-local
      - uses: actions/upload-pages-artifact@v4
        with:
          path: _site
      - name: Deploy public artifact
        id: deployment
        uses: actions/deploy-pages@v4
```

References: [Pages workflow requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Node setup](https://github.com/actions/setup-node), [Ruby setup](https://github.com/ruby/setup-ruby). The workflow's npm/public build was checked locally; the GitHub-hosted workflow itself has not been executed.

## 9. Smoke test, then open guest sharing

Keep the QR private while testing. Use a small controlled collection first:

1. Open production management and sign in. Confirm settings, private previews and the QR URL.
2. Check the guest page loads all CSS, JavaScript, compression worker and HEIC chunks over HTTPS, with the intended API and Worker targets.
3. Upload a small admin batch with guest sharing still closed. Confirm only JPEG/WebP thumbnail/display variants are transferred; originals are not uploaded.
4. Temporarily open guest sharing for the controlled guest test. On an actual iPhone Safari and Android Chrome, check camera/library selection, preview, rotated photos, HEIC and live Turnstile.
5. With prior approval off, verify a validated guest photo appears automatically. With it on, verify the next photo stays pending. Turning it off again must not expose the earlier pending photo.
6. Bulk hide/show a few photos. Fresh feeds must exclude hidden photos immediately; allow the documented five-minute link/cache window. Retained private previews must still work.
7. Interrupt before upload authorization, during transfer and during completion. Reload and retry. Confirm session restoration/renewal and no duplicate completed IDs. Leave management open past link expiry and check thumbnail recovery.
8. Check a representative 500-photo admin collection on the intended computer, then the upper intended size if needed. Measure duration, memory, failures and recovery. Confirm Worker production CPU remains compatible with Free during normal and worst-case allowed requests.
9. Reclose sharing if anything fails. Once accepted, choose the final auto/prior-approval mode, open guest sharing, download the production QR and distribute it.

Test cost cutoffs/quota failures locally rather than deliberately exhausting production allowance. Record the operator, account-review timestamp and smoke-test outcome with the release.

## 10. Large batches, maintenance and limits

| Setting | Current value |
| --- | --- |
| Thumbnail | 400 px maximum edge; 50,000 bytes |
| Display | 1,600 px maximum edge; 500,000 bytes |
| Input | At most 30 MB / 50 megapixels; device decoding still needs memory |
| Guest session | At most 20 photos per session |
| Event | At most 5,000 photos; at most 3,000 guest photos |
| Admin protection | Space protected for 2,000 admin photos' retained/published copies |
| Processing | One source compressed at a time; at most two photos transferring |
| Reload cache | Up to 25 MB of compressed files; large batches may require source reselection |
| Maintenance | Every 15 minutes; up to 10 due photo records cleaned plus bounded publication repair |

At authorization, each photo reserves space for staging, retained and published pairs. A maximum 550 KB pair reserves 1.65 MB initially. If 3,000 guest photos already occupy 3.3 GB in retained/published pairs, staging 2,000 maximum-size admin photos would need another 3.3 GB and exceed the 6 GB guard. Expect a pause or split batches while staging cleanup releases reservations. Do not promise every upper-limit batch will fit at once.

Keep the page open during upload. Pause/resume and retry unfinished photos. The page records completed IDs, but the reload cache cannot hold a 2,000-photo collection. Keep source originals separately.

Use **Retry pending operations** for bounded cleanup/repair. Uncertain transfers can conservatively retain reservations; do not lower database counters to force more uploads. A lifecycle deletion is not sufficient proof to release a reservation. Admin guest-sharing and admin-upload switches are independent.

## 11. Renew at each billing boundary

1. Verify the actual new Cloudflare billing period, usage and protected shared allowance.
2. Update `.gallery-local/cloudflare-review.json` with fresh facts and timestamps.
3. From the Worker folder, run the reviewed dry run and deploy wrapper again.
4. Update Firebase's `GALLERY_BILLING_START` / `GALLERY_BILLING_END` to match, then redeploy the function.
5. Verify image delivery, management and one small upload.

Both platforms pause at the configured end. Do not assume renewals are automatic. Preserve photo capacity and retained objects across periods; never change the start date inside one period to create another operation budget.

## 12. Troubleshooting and rollback

| Symptom | Check / action |
| --- | --- |
| `GALLERY_DISABLED` | Check the intended deployed function's gallery flag and secret bindings. |
| `COST_REVIEW_REQUIRED` | Check both matching UTC periods and the Worker cutoff; complete a real account review before renewing. |
| Turnstile failure | Check hostname, action and production key pair; used/expired challenge tokens need a fresh challenge. |
| Missing chunks / blank public page | Build the guest assets before Jekyll, publish every generated chunk, and confirm API/path settings. |
| Thumbnail still unavailable | Automatic refresh is bounded to once per minute per photo. Use Refresh photos after resolving the underlying access/storage issue. |
| Storage or operation limit | Pause, inspect usage/reservations and run bounded cleanup. Resume only when safe; do not raise limits or reset counters. |
| Worker daily limit | Stay on Free; wait for the UTC daily reset. Keep buckets private and routing fail closed. |
| Missing Firestore index | Wait for the deployed gallery indexes to finish building; check the selected project. |

For rollback, first close guest/admin uploads. Disable the gallery flag and redeploy Firebase if needed; an expired Worker cost review stops image access as well. Restore a known-good compatible release while preserving metadata, buckets and secrets. Secret rotation must update both matching platforms together.

Retained-photo export/deletion is not an admin feature in this version. Agree an export, verification and retention date before any deletion. Keep originals outside the gallery. Updating the gallery does not require reseeding or deleting invitation data.

## Release checklist

- [ ] Local checks and both regression cases pass.
- [ ] Workers Free, both private Standard buckets and shared allowance verified.
- [ ] Fresh cost review covers the actual billing period; matching Worker/Firebase cutoff set.
- [ ] Matching secrets installed, real Turnstile configured, gallery indexes ready.
- [ ] Complete guest artifact published through a verified host build process.
- [ ] Production admin/guest smoke checks, iPhone/Android and admin batch accepted.
- [ ] Automatic/prior approval setting chosen; guest sharing opened only after acceptance.
- [ ] QR points to production; monthly review and retention/export owners assigned.

The Firebase CLI's last review reported 13 moderate development-tool dependency advisories; the backend production, guest, admin and Worker tooling audits reported zero. Recheck before release and review compatible CLI updates deliberately rather than accepting a forced major downgrade. Local tests do not establish production account settings or prove a $0 invoice.

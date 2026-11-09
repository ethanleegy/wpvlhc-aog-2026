# Christmas Social gallery Worker

For the full production sequence and a plain-language breakdown, use the [production deployment runbook](../../api-spec/PROD_DEPLOYMENT_README.md).

Local R2 development and controlled upload/image delivery for the Christmas Social. Compression runs in the browser. Run the full local system from the repository root with `npm run gallery:local`; it creates only demo Firestore data, local R2 objects and temporary local secrets.

The existing Worker/bucket names, public hostname and `gala-2026` object paths are deployed technical identifiers. They stay unchanged for Christmas Social so stored photos, signatures and configured origins remain valid.

`npm run check` builds a deployment dry run. It does not upload a Worker or create buckets. The development configuration deliberately has an empty cost-review expiry and localhost API URL; it cannot serve production uploads/images as shipped.

## Production prerequisites

The backend must also be deployed to Firebase. Cloudflare hosts the image gateway and R2 objects; it does not replace the Firebase API or the existing public/admin hosting.

Before production, verify Workers Free, two R2 Standard buckets with **all direct public access disabled**, the account's billing-period boundaries and remaining shared allowances. Protect that headroom from other workloads. Confirm the public and admin HTTPS origins, configure Turnstile Free for the public hostname with action `gallery-upload`, and verify the deployed API can reach the Worker. Do not enable a paid plan, Images or Cache Reserve.

Create independent, random secrets of at least 32 bytes and store them outside source control. Firebase needs `GALLERY_TICKET_SECRET`, `GALLERY_INTERNAL_SECRET`, `GALLERY_CLAIM_SECRET` and `GALLERY_TURNSTILE_SECRET` in Secret Manager when the gallery is enabled. Worker secrets are the matching `TICKET_SECRET`, `INTERNAL_SECRET` and `CLAIM_SECRET`. Never reuse the admin session key. Configure them on the reviewed Worker before opening uploads.

The deployment wrapper reads `.gallery-local/cloudflare-review.json` (or `GALLERY_COST_REVIEW_FILE`). Populate it from the actual account review, not an estimate:

```json
{
  "accountId": "<reviewed account ID>",
  "workersPlan": "free",
  "r2StorageClass": "Standard",
  "privateBucketsVerified": true,
  "sharedAllowanceProtected": true,
  "checkedAt": "<UTC account-check timestamp>",
  "billingStart": "<actual UTC billing-period start>",
  "billingEnd": "<actual UTC billing-period end>",
  "otherStorageBytes": 0,
  "otherClassAWrites": 0,
  "otherClassBReads": 0,
  "apiBase": "https://wpvlhc-aog-2026.web.app/v1",
  "allowedOrigins": ["https://wpvlhc-gala-2026.ivory-gy.com", "https://wpvlhc-aog-2026.web.app"]
}
```

The three zero values are schema examples only: replace them with verified non-gallery usage and allocations, including current-period historical operations. The wrapper checks the review's shape and age; it does not independently fetch billing data or prove that other account users will preserve the allowance. Local tests do not prove a $0 production invoice.

First run `node scripts/deploy.mjs --dry-run` from this folder after the review. Only then use `npm run deploy`. The wrapper uses the reviewed account and HTTPS origins, refuses missing/expired reviews or insufficient headroom, and sets the Worker's expiry to the reviewed billing end. At that boundary, uploads/images pause until the next verified period is configured. Select fail-closed routing for any custom domain and retain no public R2 fallback.

Use a private-bucket lifecycle rule for abandoned staging as a backup, and keep the Worker’s 15-minute scheduled maintenance trigger enabled. It calls a protected, bounded Firebase repair/cleanup operation rather than scanning buckets. The admin's Retry pending operations button also performs bounded repair/cleanup. Retained-photo deletion is not automatic in this version; agree an export and retention date first.

Workers Free has a shared 100,000-request UTC daily ceiling. Image views, previews, upload attempts, preflights and internal storage calls all consume it; the gallery may pause on a busy day. The implementation permits at most one R2 read in a Worker request, with separately counted backend allowances. Failed and uncertain upload attempts remain counted. Hiding excludes a photo from fresh feeds immediately; already issued viewing links and cached files may remain usable for up to five minutes. This version relies on that expiry rather than promising instant global cache invalidation.

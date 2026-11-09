# WPVLHC Cloudflare Gallery Handover

Date: November 4, 2026. Repository snapshot: `6f8d171` on `main`.

We are adding a mobile photo gallery to the WPVLHC AOG Christmas Social application. Guests should scan a QR code, take a photo or select existing pictures, and upload them. Church management must be able to view every submitted photo, with approval and denial under consideration. Our team owns storage, hosting, ingestion and retrieval; the frontend developer will build the public gallery display against our API.

**The next chat should plan the approach with the user before implementation.** Cloudflare free-tier usage and strong mobile compression are requirements. The architecture, compression thresholds, moderation policy and endpoint designs below are planning inputs. Gallery routes are not part of the current implemented API.

## Current project

| Area | Current state |
| --- | --- |
| Workspace | `/Users/tarico/git/wpvlhc-aog-2026` |
| Repository | [ethanleegy/wpvlhc-aog-2026](https://github.com/ethanleegy/wpvlhc-aog-2026) |
| Public website | `https://wpvlhc-gala-2026.ivory-gy.com` — Jekyll and Tailwind |
| Admin application | `https://wpvlhc-aog-2026.web.app` — React and Vite on Firebase Hosting |
| API base | `https://wpvlhc-aog-2026.web.app/v1` |
| Direct function base | `https://us-central1-wpvlhc-aog-2026.cloudfunctions.net/api/v1` |
| Backend | Node.js 24, Express 5, Joi, Firebase Functions v2, Firestore Admin SDK |
| Firebase project | `wpvlhc-aog-2026`; HTTPS function `api`, region `us-central1` |
| Existing features | Named invitations, RSVP, single-person food slots, church management, reports and CSV exports |
| Seed | 200 sample members and 150 Guyanese food slots: 50 menu items repeated three times |

Food slots are unrelated to gallery upload limits. The seed member names are sample data, not a confirmed membership list. Preserve existing invitation URLs, reservations and responses while adding the gallery.

The public domain serves static pages, not `/v1` routes. Public JavaScript needs the absolute API base above. Admin calls use same-origin `/v1/admin` through Firebase Hosting. The existing public RSVP JavaScript remains a frontend integration task; gallery work should not silently take over that work.

Start with these repository files:

- [Frontend API handoff](APISPECS.md) and [current OpenAPI contract](openapi.json).
- [Firebase setup and data model](../firebase/README.md).
- [API routing and middleware](../firebase/functions/src/app.js), [authentication](../firebase/functions/src/auth.js), and [configuration](../firebase/functions/src/config.js).
- [Firestore service](../firebase/functions/src/service.js), [validation](../firebase/functions/src/validation.js), and [database rules](../firebase/firestore.rules).
- [React management application](../firebase/admin-dashboard/src/App.jsx) and [API client](../firebase/admin-dashboard/src/api.js).
- [Hosting configuration](../firebase/firebase.json) and [API specification checker](../firebase/scripts/check-spec.cjs).

## User requirements and working preferences

- A QR code should open a phone-friendly upload experience.
- Guests can take new pictures or upload pictures already on their phones.
- Admins can view all submitted photos. Confirm whether approval and denial are required before public display.
- Provide an API and usable image URLs so the frontend developer controls the public gallery layout.
- Compress aggressively for mobile viewing and keep Cloudflare usage within its free allowances.
- Keep changes focused and follow the existing Node, Joi and Firestore conventions.
- Do not commit or push on the user's behalf. Do not deploy or create cloud resources as part of this planning handover.
- When guiding credential setup, give one command or small step at a time. The user found a long sequence confusing.

## Guest and admin journeys

1. The guest scans a QR code containing a stable HTTPS page URL, for example `/gallery/upload/`. It should not contain a temporary R2 upload URL or an admin credential.
2. The page offers **Take a photo** and **Choose photos**. Keep a normal file-picker fallback.
3. The guest previews the choices. The page applies the agreed resizing/compression rules and shows progress and recoverable errors.
4. The backend authorizes a bounded upload session. The browser uploads the files to private storage using the selected upload mechanism.
5. Completion is confirmed by the backend after validation, not just by a client claim that uploading finished. Repeated completion requests must not create duplicate photos.
6. Management sees uploaded photos in the protected React application. If moderation is enabled, new validated photos await approval; denied photos remain visible to admins until the agreed cleanup date.
7. The public gallery API returns published photos with thumbnail and display URLs. The frontend decides layout, lazy loading, pagination and fullscreen viewing.

A native capture input such as `accept="image/*" capture="environment"` is a candidate for the camera button; browser behavior varies, so it needs device testing. A custom camera preview using `getUserMedia()` requires a secure context and user permission. A QR scan should open the page, which then asks the guest to choose an action. [HTML capture](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture), [camera access](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

## Responsibilities

| Owner | Work |
| --- | --- |
| Backend and hosting team | Cloudflare setup, storage permissions, upload authorization, validation, canonical image processing, metadata, moderation, delivery URLs, quotas, cleanup and API specifications |
| Frontend developer | QR landing/upload UI, camera/file selection, client compression integration, progress/retry states, and the public gallery display |
| Existing admin application | Add photo management using the existing protected session and admin APIs; keep public gallery rendering separate |
| Next chat with the user | Decide architecture, moderation, formats, limits, retention and delivery before building |

Client compression and backend validation need one shared contract. Browser compression improves transfer size, but the backend must still enforce its rules against a modified client.

## Architecture choices for the next chat

The smallest change to evaluate first is **R2 Standard for image bytes, Firestore for metadata, and the existing Firebase API for upload authorization and administration**. This reuses the existing admin login. Add a Cloudflare Worker only where it provides a clear delivery or validation benefit.

| Choice | Benefit | Decision needed |
| --- | --- | --- |
| Existing Firebase API signs direct R2 uploads | Reuses Joi, secrets and admin sessions; image bytes bypass Firebase HTTP handlers | Where trusted image validation and encoding run |
| Private R2 staging plus a separate published bucket/domain | Unreviewed images stay private; published images can use direct CDN delivery | How promotion, rejection, deletion and cache invalidation work |
| Private R2 with a Worker serving permitted images | Central control over access and publication | Worker request budget, metadata lookups and caching cost |

The current Express API accepts JSON bodies up to **32 KB**. Keep authorization/completion requests small; do not send photos as base64 through the existing JSON routes. Direct uploads also avoid making Firebase the transport for every photo.

Existing admin cookies are `__session`, HttpOnly, Secure in production, and SameSite=Strict. A Worker on another domain will not automatically receive that browser session. Keeping moderation APIs on the existing Firebase admin origin avoids introducing a second login or an unplanned authentication bridge.

The earlier [Tevin and Natallia reference application](https://github.com/TaricoHenry/2026-tevin-and-natallia) contains gallery/R2 upload patterns worth reviewing. Recheck the current code and adapt it; this project should retain its stricter credential and database-access rules. The other original reference is [Ashley and Navin](https://github.com/TaricoHenry/ashley-and-navin).

## Compression targets to discuss

These are proposed starting targets, not measured results or final limits. Optimize for clear faces and phone screens rather than retaining camera-resolution originals by default.

| Output | Proposed size | Proposed encoded bytes | Purpose |
| --- | --- | --- | --- |
| Thumbnail | Long edge around 400 px | Aim for 20–50 KB | Gallery grid |
| Display image | Long edge at most 1600 px | Aim for 150–300 KB; consider a 500 KB hard cap | Phone fullscreen viewing |
| Original | No permanent retention by default | Decide any temporary upload limit separately | Processing input only, unless originals are explicitly wanted |

- Evaluate JPEG and WebP first. Treat AVIF encoding as an option to benchmark, not a guaranteed capability of every phone/browser.
- Choose an explicit HEIC/HEIF strategy for iPhone uploads. Test the actual camera and photo-library paths rather than assuming they return JPEG.
- Apply orientation before discarding metadata. Strip location metadata from published copies and return the final width/height.
- Use bounded compression attempts and verify the actual output MIME type, byte count and decodability. Handle files that cannot meet the agreed limit.
- Precompute a small fixed set of variants. Do not create arbitrary resize/quality combinations on each gallery view.
- Start with paginated thumbnail responses, for example 20 photos per page. At 50 KB each that is about 1 MB of image data, excluding other page assets. Load display images when opened.

Still photos are the initial scope. Confirm supported input formats and whether animated images or videos should be rejected.

## Cloudflare free tier constraints

Limits below were checked against official documentation on November 4, 2026. Recheck the account's plan and existing usage before provisioning.

| Product | Published free allowance | Design implication |
| --- | --- | --- |
| R2 Standard | 10 GB-month storage; 1 million Class A and 10 million Class B operations monthly; direct R2 internet egress has no charge | Budget stored bytes and operations, including staging and published copies |
| Workers Free | 100,000 requests per day and 10 ms CPU per request | Avoid assuming every image can pass through a Worker, or that general photo encoding fits its CPU budget |
| Images Free | 5,000 unique transformations per month for images stored outside Images | Fix the variant count and account for processing/reprocessing |
| Cloudflare Images hosted storage | Available on paid Images plans | Do not confuse R2 storage with free hosted storage in Images |

R2's free allowance applies to **Standard**, not Infrequent Access. Usage beyond the allowance can be billed, so “free tier” is not an application spending cap. Other metered services attached to R2 can have separate charges. [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

Images Free stops accepting new transformations after its allowance is exhausted, while existing cached transformations can continue. It does not charge overages on that Free plan. [Images pricing](https://developers.cloudflare.com/images/pricing/).

Use the [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) when deciding whether a Worker belongs in the image delivery path. For example, 200 viewers each loading 2,000 thumbnails would produce 400,000 image requests. Routing every one through a Worker could exceed the daily request allowance even when R2 storage is small.

### Illustrative storage and processing budget

Assume 200 contributors upload 10 photos each: **2,000 photos**. At a 300 KB display image plus a 50 KB thumbnail, the two stored variants total approximately **700 MB, or 0.7 GB**, using decimal units. This excludes temporary uploads, duplicates, other projects and any originals.

Keeping a 15 MB original for every photo would add **30 GB**. Compression must therefore affect retained files and staging lifetime, not just how pictures look on screen. If each photo consumes exactly two billable unique transformations, that is 4,000 transformations; verify actual accounting and leave room for retries and additional variants.

The plan needs an application upload cap, a global byte budget with headroom, cleanup for abandoned uploads, and a way to stop new uploads before the account's remaining free allowance is exhausted. Budget alerts are useful but do not replace enforcement. Existing Firebase costs remain separate from the Cloudflare free-tier goal.

## Upload and publication boundaries

R2 presigned URLs grant temporary access to a specific object/operation, can be reused until expiry, and use the S3 API domain rather than an R2 custom domain. [Presigned URL behavior](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

The proposed pipeline should:

1. Generate object keys on the server and reserve quota before issuing short-lived upload authorization. Keep upload tickets separate from admin credentials.
2. Upload to private staging. Validate actual object bytes, decoded image dimensions and allowed formats; client filenames and MIME headers are insufficient.
3. Freeze/copy the submitted object to a server-controlled processing key before validating it, or use an equivalent design that prevents later PUTs from changing the bytes being approved. A completion token alone does not make an R2 PUT URL single-use.
4. Publish only verified derivatives to keys that the guest's upload authorization cannot overwrite. If approval is required, publication follows approval.
5. Keep pending/denied images private. Hiding a row from JSON does not protect an object in a publicly readable bucket. Admin previews need authenticated delivery or short-lived authorized URLs.
6. Define unpublishing, cache invalidation and cleanup. Removing a published item cannot remove copies a visitor has already downloaded.

Browser uploads need an R2 CORS policy allowing the intended origin, PUT method and required headers even when the URL is correctly signed. CORS is not authentication. [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).

Use a proper custom domain or an evaluated Worker delivery route for production. Cloudflare describes `r2.dev` as a development endpoint with rate limits. [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/).

## Proposed API contract

These names and shapes are for discussion. Do not treat them as implemented endpoints or add them to the live OpenAPI contract until the plan is accepted.

| Method | Proposed path | Purpose |
| --- | --- | --- |
| POST | `/v1/gallery/uploads` | Reserve a bounded photo upload; return photo IDs, signed PUT URL(s), required headers, expiry, completion token and applicable limits |
| POST | `/v1/gallery/uploads/{photoId}/complete` | Confirm and validate the uploaded objects; return the authoritative upload/moderation state |
| GET | `/v1/gallery/photos?limit=20&after=...` | Cursor-paginated published gallery feed |
| GET | `/v1/admin/gallery/photos?status=pending&limit=20&after=...` | Protected view of all submissions, with optional status filtering and authorized preview URLs |
| PATCH | `/v1/admin/gallery/photos/{photoId}` | Approve or deny a photo; publish only once its verified variants are ready |

The signed R2 PUT is a separate binary upload, not another JSON endpoint on the Firebase API. If processing is asynchronous, define a status/polling mechanism and do not report a photo as ready before validation finishes.

Candidate public response:

```json
{
  "photos": [
    {
      "id": "photo-example-001",
      "thumbnailUrl": "https://photos.example.com/approved/photo-example-001/thumb.webp",
      "displayUrl": "https://photos.example.com/approved/photo-example-001/display.webp",
      "width": 1200,
      "height": 1600,
      "publishedAt": "2026-12-12T22:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

`photos.example.com` is a placeholder, not an existing delivery domain. Return image URLs and dimensions so the frontend can display photos without knowing bucket names or signing rules. Do not return private storage keys, upload tokens, pending previews or credentials in public responses.

If Firestore remains the metadata store, consider a new `Photos` collection with an opaque ID, event scope, upload state, moderation state, object keys, final MIME/dimensions/byte sizes, creation/publication times and moderation timestamps. Store object references rather than expiring signed URLs. Suggested review states are `pending`, `approved` and `denied`, with separate upload/validation state if needed.

Reuse the current admin session, required `X-Admin-Request: true` mutation header, Joi validation, UTC timestamps and JSON error envelope. Public upload completion must not let guests set approval state. Add indexes and extend `openapi.json`, `APISPECS.md` and the route checker alongside implemented routes. Review the middleware if introducing new HTTP methods or router mounts.

## Decisions for the next chat

1. Is the QR shared by the event, or linked to an invitation? Must an uploader identify themselves? Do not assume RSVP is required.
2. Is approval mandatory before public viewing? Should denied photos remain available to admins, and for how long?
3. Is the gallery publicly readable or restricted to guests?
4. How many photos may each person/session upload, and what is the total event cap? The 2,000-photo example is an assumption.
5. Do we retain originals or only compressed variants? What are the input/output byte limits and quality targets?
6. Where will HEIC conversion, validation and canonical encoding run? Compare processing cost, compatibility and operational work.
7. Which buckets, delivery domain, caching strategy and account allowances will be used? Who controls the Cloudflare zone?
8. What happens when quotas are reached, uploads are interrupted, or processing fails? Agree on retention and abandoned-upload cleanup.

## Acceptance criteria after implementation

- QR-to-upload works on iPhone Safari and Android Chrome, with camera and existing-photo options and a useful fallback.
- Photos remain correctly oriented and readable after compression; measured sizes meet the agreed limits.
- Slow uploads show progress, failures can be retried, and repeated completion does not duplicate photos.
- Oversized, invalid and unsupported uploads are rejected by the backend; quotas are enforced before unrestricted storage use.
- Admins can browse all relevant submission states and view private previews through protected access.
- If moderation is enabled, pending/denied images are absent from the public feed and public object delivery. Admin previews use separate authorized access; unpublishing follows the agreed invalidation window.
- Approved photos reach the public feed; denial/unpublishing follows the agreed cache policy. A guest cannot overwrite an approved photo using an old upload URL.
- The public feed is paginated and returns small thumbnails plus display URLs and dimensions. The frontend can implement its own layout.
- Actual storage, request and transformation usage fit the agreed free-tier budget, including temporary copies and retries.
- Existing RSVP, food reservations, login and reports still pass their tests. New gallery operations have matching API specifications and focused tests.

## Starting the next chat

Suggested opening message:

> Read `api-spec/CLOUDFLARE_GALLERY_HANDOVER.md` and the current backend/API docs in this repository. Plan the Cloudflare gallery before changing code or creating resources. We want QR-based camera/photo uploads, mobile compression, admin viewing with possible approval/denial, and a gallery endpoint for the frontend developer. Compare the simplest approaches that can stay within Cloudflare's free allowances, explain the tradeoffs, and help us decide the open questions. Keep changes minimal and do not commit or push.

Begin by checking the current Git state and repository instructions, then inspect the Cloudflare account's relevant capabilities and usage when access is available. Present the proposed flow, architecture, budget and decisions before implementation.

The preceding backend review passed 6 unit tests and 7 Firestore emulator integration tests, checked all 22 registered API operations and 26 emulator HTTP responses against OpenAPI, and built the React and Jekyll sites. The last live check returned 200 for `/v1/ready`, 401 for an unsigned admin session, and 150 available food slots. Treat these as the handover baseline rather than proof of future deployments.

From the repository root, the existing checks are:

```sh
npm test
npm --prefix firebase run test:integration
npm run admin:build
bundle exec jekyll build
```

Use Node.js 24 and Java 21+ for the emulator. Local production scripts using the Admin SDK need Application Default Credentials; Firebase CLI login alone is not sufficient. No credentials or secret values belong in this handover.

# Gallery browser client

The guest sharing interface and admin queue share the same browser compression library. The uploading device produces metadata-free JPEG/WebP variants: thumbnail up to 400 px / 50,000 bytes, display up to 1,600 px / 500,000 bytes. Orientation is applied before encoding. Source files stay on the device. HEIC conversion is lazy-loaded only when native decoding cannot open the image; it still runs locally.

From the repository root, install dependencies in `gallery-client/`, `firebase/`, `firebase/functions/`, `firebase/admin-dashboard/` and `cloudflare/gallery-worker/` with their lockfiles. Use Node 24 and Java 21+ on PATH. Then run `npm run gallery:local`.

| Local service | Address |
| --- | --- |
| Guest sharing and gallery | http://127.0.0.1:5174/ |
| Church management | http://127.0.0.1:5173/ |
| Firebase API | http://127.0.0.1:5999/v1 |
| Local image Worker | http://127.0.0.1:8787 |

Local management login: `localadmin` / `local-gallery-only`. These credentials are generated/configured only for the demo emulator. The launcher creates random local signing keys and uses no production database or Cloudflare storage. Stop it with Ctrl+C. Local R2 files persist under `.gallery-local/`; the default Firestore emulator data is temporary, so restart does not promise to restore prior gallery metadata. For a clean rerun, remove only disposable local R2 data after stopping the launcher.

The guest flow is Take/choose → preview → Share photos. Automatic publication is the default. Prior approval, guest/admin upload switches and bulk hide/show live under Photo gallery in management. An individual failed upload does not block successful photos.

Guest upload authorization restores or renews its session for share, retry and resume, including after reload. Already authorized uploads reconcile their saved IDs first. Management refreshes failed thumbnail links at most once per photo per minute. Session unit regressions run with `npm --prefix gallery-client test` (also included in root `npm test`); browser regressions cover reload/retry and expired thumbnails.

The admin queue compresses one source at a time, transfers at most two photos concurrently, and bounds persisted compressed data to 25 MB. It retains completed IDs across reloads. A browser may require source-file reselection to resume; the page must remain open while sharing. Hidden photos are retained for management, and changing approval mode does not expose them.

`npm run gallery:build` builds browser assets, management and a Worker deployment dry run. The Jekyll upload page is `/gallery/upload/`; build the gallery client before `bundle exec jekyll build` so `/assets/gallery/` exists. The generated assets are ignored by Git and must be included by the public host's build/publishing process. Do not assume a plain Jekyll-only host will run npm automatically. The existing invitation JavaScript integration remains separate.

`npm run gallery:test:e2e` runs a local Chrome test using the same services; installed Chrome is used by default, or set `PLAYWRIGHT_CHANNEL`. Unit and Firestore integration checks are under `firebase/functions/`, with isolated demo namespaces. Worker runtime checks are under `cloudflare/gallery-worker/`.

Before launch, perform real-device camera/library tests on iPhone Safari and Android Chrome, including rotated and HEIC photos and interruption recovery. The local automated browser check does not prove those device-specific cases or a 2,000-photo real-world batch. Use a representative large collection to measure duration and memory on the intended admin device.

Start production work with the [complete deployment runbook](../api-spec/PROD_DEPLOYMENT_README.md). Cloudflare-specific details remain in [the Worker guide](../cloudflare/gallery-worker/README.md). Firebase and frontend hosting still need their own releases; deploying only the Worker is not a complete gallery deployment.

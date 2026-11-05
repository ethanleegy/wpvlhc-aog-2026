# API specifications

- [APISPECS.md](APISPECS.md): frontend flow, endpoint table, payload examples, errors and integration guidance.
- [openapi.json](openapi.json): OpenAPI 3.0.3 contract for all 43 public, management and Worker-internal operations, including the locally implemented gallery. Import into Swagger Editor or an API client.
- [Cloudflare gallery handover](CLOUDFLARE_GALLERY_HANDOVER.md): current backend context, QR/photo flow, mobile compression, free-tier constraints and planning questions for the next chat. Gallery endpoints in it are proposals, not part of the implemented API.
- [Gallery architecture draft](GALLERY_ARCHITECTURE_DRAFT.md): proposal for seamless guest sharing, automatic publication, bulk hide/show and device compression, with a revised Cloudflare $0 design using private R2 buckets, controlled image delivery and usage cutoffs. The core flow is implemented locally; account headroom and production cutoff behaviour must be verified before deployment.
- [Local gallery guide](../gallery-client/README.md) and [Cloudflare setup guide](../cloudflare/gallery-worker/README.md): running, testing, browser compression, deployment dependencies and the account review required before production.

Validate from the repository root with `npm --prefix firebase run spec:check` or `npm test` after installing both `firebase/` and `firebase/functions/` dependencies. The check validates OpenAPI syntax, unique operation IDs and exact coverage of the registered backend routes without accessing credentials or a database. The public Jekyll JavaScript is intentionally left for the frontend developer to connect, as described in APISPECS.

# API specifications

- [APISPECS.md](APISPECS.md): frontend flow, endpoint table, payload examples, errors and integration guidance.
- [openapi.json](openapi.json): OpenAPI 3.0.3 contract for all 22 public/management operations. Import into Swagger Editor or an API client.

Validate from the repository root with `npm --prefix firebase run spec:check` or `npm test`. The public Jekyll JavaScript is intentionally left for the frontend developer to connect, as described in APISPECS.

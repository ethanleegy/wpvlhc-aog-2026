# Christmas Social Functions API

Node.js 24, CommonJS, Firebase Functions v2, Express 5, Joi and Firestore Admin SDK.

The event is Christmas Social 2026. Backend CSV downloads are named `christmas-social-guests.csv` and `christmas-social-food.csv`. Persistent event IDs, storage paths and retry-key namespaces retain their deployed values; see the [event naming note](../../README.md).

- `index.js`: HTTPS function and Secret Manager bindings.
- `src/app.js`: `/v1` public and `/v1/admin` management routes, middleware and errors.
- `src/validation.js`: strict schemas; unknown fields rejected.
- `src/service.js`: Firestore transactions, invitation URLs and reporting.
- `src/auth.js`: bcrypt sign-in, JWT cookie sessions and shared rate counters.
- `src/config.js`: required configuration without default credentials.
- `src/csv.js`: spreadsheet-safe exports.
- `src/dev.js`: optional standalone local server; importing the function starts no listener.
- `test/`: unit tests and real-emulator HTTP integration tests.

Run `npm test` here. From the repository root, run `npm --prefix firebase run test:integration` for the Firestore integration suite.

For the optional standalone server, set `GCLOUD_PROJECT=demo-wpvlhc`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, local settings and both secrets in the environment, then run `npm start`. It binds `127.0.0.1:5999` (override `PORT` if needed). This process does not load `.secret.local`; the recommended workflow uses the Functions emulator.

See [Firebase setup and data model](../README.md) and [frontend APISPECS](../../api-spec/APISPECS.md).

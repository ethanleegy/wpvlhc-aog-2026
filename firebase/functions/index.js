const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { createApp } = require("./src/app");
const { loadConfig } = require("./src/config");
const { getDb } = require("./src/firestore");

exports.api = onRequest(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 60,
    maxInstances: 10,
    secrets: [
      defineSecret("ADMIN_PASSWORD_HASH"),
      defineSecret("ADMIN_JWT_SECRET"),
      ...(process.env.GALLERY_ENABLED === "true" ? [
        defineSecret("GALLERY_TICKET_SECRET"),
        defineSecret("GALLERY_INTERNAL_SECRET"),
        defineSecret("GALLERY_CLAIM_SECRET"),
        defineSecret("GALLERY_TURNSTILE_SECRET"),
      ] : []),
    ],
  },
  createApp({ getDb, getConfig: loadConfig }),
);

const { ApiError } = require("./errors");
function loadGalleryConfig(env, local) {
  if (env.GALLERY_ENABLED !== "true") return null;
  for (const name of ["GALLERY_TICKET_SECRET", "GALLERY_INTERNAL_SECRET", "GALLERY_CLAIM_SECRET"])
    if (!env[name] || Buffer.byteLength(env[name]) < 32) throw new Error(`${name} requires at least 32 bytes`);
  const worker = new URL(env.GALLERY_WORKER_URL);
  if (worker.username || worker.password || worker.search || worker.hash || worker.pathname !== "/" || (!local && worker.protocol !== "https:") || !["http:", "https:"].includes(worker.protocol)) throw new Error("Invalid GALLERY_WORKER_URL");
  const start = Date.parse(env.GALLERY_BILLING_START), end = Date.parse(env.GALLERY_BILLING_END);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 31 * 86400000) throw new Error("Gallery needs a verified billing period of at most 31 days");
  if (!local && (env.GALLERY_FREE_PLAN_VERIFIED !== "true" || !env.GALLERY_TURNSTILE_SECRET || !env.GALLERY_TURNSTILE_SITE_KEY)) throw new Error("Verify the free plan and configure Turnstile before enabling production gallery uploads");
  return {
    local, workerUrl: worker.origin, ticketSecret: env.GALLERY_TICKET_SECRET,
    internalSecret: env.GALLERY_INTERNAL_SECRET, claimSecret: env.GALLERY_CLAIM_SECRET,
    billingStart: start, billingEnd: end,
    turnstileSecret: env.GALLERY_TURNSTILE_SECRET || "", turnstileSiteKey: env.GALLERY_TURNSTILE_SITE_KEY || "",
    publicHostname: new URL(env.PUBLIC_SITE_URL).hostname,
  };
}
function assertGallery(config) {
  if (!config) throw new ApiError(503, "GALLERY_DISABLED", "Photo sharing is not open yet");
  if (Date.now() < config.billingStart || Date.now() >= config.billingEnd) throw new ApiError(503, "COST_REVIEW_REQUIRED", "Photo sharing is paused until its free allowance is checked");
  return config;
}
module.exports = { loadGalleryConfig, assertGallery };

const { loadGalleryConfig } = require("./gallery-config");
function loadConfig(env = process.env) {
  const local = env.LOCAL_DEVELOPMENT === "true";
  const emulator =
    env.FUNCTIONS_EMULATOR === "true" || Boolean(env.FIRESTORE_EMULATOR_HOST);
  if (local && !emulator)
    throw new Error("LOCAL_DEVELOPMENT requires Firestore emulation");
  for (const name of [
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD_HASH",
    "ADMIN_JWT_SECRET",
    "PUBLIC_SITE_URL",
    "ALLOWED_ORIGINS",
  ]) {
    if (!env[name]) throw new Error(`Missing required configuration: ${name}`);
  }
  if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(env.ADMIN_PASSWORD_HASH)) {
    throw new Error("ADMIN_PASSWORD_HASH must be a bcrypt hash");
  }
  if (Buffer.byteLength(env.ADMIN_JWT_SECRET) < 32)
    throw new Error("ADMIN_JWT_SECRET needs at least 32 bytes");
  const site = new URL(env.PUBLIC_SITE_URL);
  const origins = env.ALLOWED_ORIGINS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origins.length)
    throw new Error("ALLOWED_ORIGINS must include at least one origin");
  for (const [index, value] of [site.href, ...origins].entries()) {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      !["http:", "https:"].includes(url.protocol)
    )
      throw new Error("Invalid configured URL");
    // HTTP loopback is permitted only in explicit CORS entries, never siteUrl.
    const loopbackOrigin =
      index > 0 &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!local && url.protocol !== "https:" && !loopbackOrigin)
      throw new Error("Production URLs must use HTTPS");
  }
  if (!origins.every((origin) => new URL(origin).origin === origin))
    throw new Error("ALLOWED_ORIGINS must contain exact origins without paths");
  if (site.hash || site.search)
    throw new Error("PUBLIC_SITE_URL must not contain a query or fragment");
  return {
    local,
    username: env.ADMIN_USERNAME,
    passwordHash: env.ADMIN_PASSWORD_HASH,
    jwtSecret: env.ADMIN_JWT_SECRET,
    siteUrl: site.href,
    origins,
    gallery: loadGalleryConfig(env, local),
  };
}
module.exports = { loadConfig };

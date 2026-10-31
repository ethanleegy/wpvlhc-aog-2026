const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createHash, timingSafeEqual } = require("node:crypto");
const { Timestamp } = require("firebase-admin/firestore");
const { ApiError } = require("./errors");

const COOKIE = "__session";
const SESSION_SECONDS = 8 * 60 * 60;
function cookieOptions(config) {
  return {
    httpOnly: true,
    secure: !config.local,
    sameSite: "strict",
    path: "/",
  };
}
function equal(a, b) {
  return timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
}
async function login(config, payload, res) {
  const passwordValid = await bcrypt.compare(
    payload.password,
    config.passwordHash,
  );
  if (!equal(payload.username, config.username) || !passwordValid)
    throw new ApiError(
      401,
      "INVALID_CREDENTIALS",
      "Incorrect username or password",
    );
  const token = jwt.sign({ username: config.username }, config.jwtSecret, {
    algorithm: "HS256",
    subject: "church-admin",
    issuer: "wpvlhc-api",
    audience: "wpvlhc-admin",
    expiresIn: SESSION_SECONDS,
  });
  res.cookie(COOKIE, token, {
    ...cookieOptions(config),
    maxAge: SESSION_SECONDS * 1000,
  });
  return { username: config.username, expiresIn: SESSION_SECONDS };
}
function authenticate(config, req) {
  try {
    const payload = jwt.verify(req.cookies[COOKIE], config.jwtSecret, {
      algorithms: ["HS256"],
      issuer: "wpvlhc-api",
      audience: "wpvlhc-admin",
      subject: "church-admin",
    });
    if (payload.username !== config.username) throw new Error("Invalid user");
    return { username: config.username };
  } catch {
    throw new ApiError(401, "UNAUTHORIZED", "Please sign in to continue");
  }
}
async function rateLimit(db, key, max, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const ref = db
    .collection("RateLimits")
    .doc(createHash("sha256").update(key).digest("hex"));
  await db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data();
    const expired = !current || current.expiresAt.toMillis() <= now;
    if (!expired && current.count >= max)
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "Too many requests. Please try again in 15 minutes.",
      );
    tx.set(ref, {
      count: expired ? 1 : current.count + 1,
      expiresAt: expired
        ? Timestamp.fromMillis(now + windowMs)
        : current.expiresAt,
    });
  });
}
module.exports = { COOKIE, cookieOptions, login, authenticate, rateLimit };

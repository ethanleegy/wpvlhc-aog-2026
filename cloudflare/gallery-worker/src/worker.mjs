import { verifyCapability } from "../../../firebase/functions/src/gallery-contract.mjs";

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (status, code, message) => json({ error: { code, message } }, status);
// Christmas Social uses the existing object namespace so deployed photos remain accessible.
const keyPattern = /^(staging|retained|published)\/gala-2026\/[a-f0-9]{32}\/[A-Za-z0-9_-]{1,80}\/(thumbnail|display)$/;
function bucket(env, name) {
  if (name === "private") return env.PRIVATE;
  if (name === "published") return env.PUBLISHED;
  throw new Error("Invalid bucket");
}
function objectRef(env, ref) {
  if (!ref || !keyPattern.test(ref.key) || (ref.bucket === "published") !== ref.key.startsWith("published/")) throw new Error("Invalid object scope");
  return { binding: bucket(env, ref.bucket), key: ref.key };
}
async function authorizedInternal(request, env) {
  const given = request.headers.get("Authorization") || "";
  if (!env.INTERNAL_SECRET || given.length > 200) return false;
  const hash = async s => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([hash(given), hash(`Bearer ${env.INTERNAL_SECRET}`)]);
  return a.reduce((n, x, i) => n | (x ^ b[i]), 0) === 0;
}
async function internalStorage(request, env) {
  if (request.method !== "POST" || !await authorizedInternal(request, env)) return fail(403, "FORBIDDEN", "Access denied");
  const text = await request.text();
  if (text.length > 4096) return fail(413, "TOO_LARGE", "Command too large");
  const command = JSON.parse(text);
  const source = objectRef(env, command.source);
  if (command.action === "delete") {
    await source.binding.delete(source.key);
    return json({ deleted: true });
  }
  if (!["read", "copy"].includes(command.action)) return fail(400, "INVALID_COMMAND", "Unsupported storage command");
  const object = await source.binding.get(source.key);
  if (!object) return fail(404, "OBJECT_NOT_FOUND", "Photo file not found");
  if (object.size > 500_000) return fail(413, "TOO_LARGE", "Photo file exceeds its limit");
  if (command.action === "read") return new Response(object.body, {
    headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Content-Length": String(object.size), "Cache-Control": "no-store" },
  });
  const target = objectRef(env, command.target);
  if (target.key.startsWith("staging/")) return fail(400, "INVALID_TARGET", "Invalid copy target");
  await target.binding.put(target.key, object.body, { httpMetadata: { contentType: object.httpMetadata?.contentType || "application/octet-stream", cacheControl: "no-store" } });
  return json({ copied: true });
}
async function upload(request, env) {
  if (request.method !== "PUT") return fail(405, "METHOD_NOT_ALLOWED", "Use PUT");
  let ticket;
  try { ticket = await verifyCapability(env.TICKET_SECRET, request.headers.get("X-Gallery-Ticket"), "upload"); }
  catch { return fail(403, "INVALID_TICKET", "Upload permission expired. Please retry."); }
  const variantCap = ticket.variant === "thumbnail" ? 50_000 : ticket.variant === "display" ? 500_000 : 0;
  if (!keyPattern.test(ticket.key) || !ticket.key.startsWith("staging/") || !variantCap || !Number.isSafeInteger(ticket.bytes) || ticket.bytes < 1 || ticket.bytes > variantCap || !/^[a-f0-9]{64}$/.test(ticket.sha256) || !["image/webp", "image/jpeg"].includes(ticket.mimeType)) return fail(400, "INVALID_TICKET", "Invalid upload permission");
  if (request.headers.get("Content-Type") !== ticket.mimeType) return fail(415, "INVALID_TYPE", "The photo format changed");
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) !== ticket.bytes) return fail(413, "WRONG_LENGTH", "The photo size changed");
  if (!request.body) return fail(400, "EMPTY_UPLOAD", "No photo supplied");
  // The claim is consumed even when the subsequent PUT is uncertain or fails.
  const claim = await fetch(`${env.API_BASE}/internal/gallery/upload-claims`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.CLAIM_SECRET}` },
    body: JSON.stringify({ ticket: request.headers.get("X-Gallery-Ticket") }), signal: AbortSignal.timeout(8000),
  });
  if (!claim.ok) return new Response(await claim.text(), { status: claim.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  const stream = new FixedLengthStream(ticket.bytes);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(120_000, Math.max(1, ticket.exp * 1000 - Date.now())));
  const pipe = request.body.pipeTo(stream.writable, { signal: controller.signal });
  const put = env.PRIVATE.put(ticket.key, stream.readable, {
    onlyIf: new Headers({ "If-None-Match": "*" }), sha256: ticket.sha256,
    httpMetadata: { contentType: ticket.mimeType, cacheControl: "no-store" },
  });
  const results = await Promise.allSettled([pipe, put]);
  clearTimeout(timer);
  const stored = results.every(r => r.status === "fulfilled") && Boolean(results[1].value);
  // A lost result acknowledgment keeps the reservation held until completion
  // observes the stored object. Cleanup never guesses that an uncertain PUT ended.
  await fetch(`${env.API_BASE}/internal/gallery/upload-results`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.CLAIM_SECRET}` },
    body: JSON.stringify({ ticket: request.headers.get("X-Gallery-Ticket"), outcome: stored ? "stored" : "failed" }), signal: AbortSignal.timeout(8000),
  }).catch(() => {});
  if (results.some(r => r.status === "rejected")) return fail(422, "UPLOAD_FAILED", "Photo transfer failed. Retry with fresh upload permission.");
  if (!results[1].value) return fail(409, "ATTEMPT_ALREADY_USED", "This upload attempt already exists");
  return json({ uploaded: true, photoId: ticket.photoId, variant: ticket.variant });
}
async function deliver(request, env, ctx, url) {
  if (request.method !== "GET") return fail(405, "METHOD_NOT_ALLOWED", "Use GET");
  let ticket;
  try { ticket = await verifyCapability(env.TICKET_SECRET, url.searchParams.get("v"), "view"); }
  catch { return fail(403, "VIEW_EXPIRED", "Refresh the gallery to load this photo"); }
  if (ticket.path !== url.pathname || !["public", "admin"].includes(ticket.scope) || (ticket.scope === "public" && ticket.bucket !== "published")) return fail(403, "FORBIDDEN", "Access denied");
  const ref = objectRef(env, ticket);
  if (ticket.scope === "public" && !ref.key.startsWith("published/")) return fail(403, "FORBIDDEN", "Access denied");
  const cacheKey = new Request(`${url.origin}${url.pathname}`);
  let response = ticket.scope === "public" ? await caches.default.match(cacheKey) : null;
  if (!response) {
    // One R2 get supplies body and metadata, including for missing objects.
    const object = await ref.binding.get(ref.key);
    if (!object) return fail(404, "PHOTO_UNAVAILABLE", "This photo is unavailable");
    response = new Response(object.body, { headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Content-Length": String(object.size), "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300", "Referrer-Policy": "no-referrer",
    } });
    if (ticket.scope === "public") ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  }
  const headers = new Headers(response.headers);
  const remaining = Math.max(0, ticket.exp - Math.floor(Date.now() / 1000));
  headers.set("Cache-Control", ticket.scope === "public" ? `public, max-age=${Math.min(300, remaining)}` : "private, no-store");
  return new Response(response.body, { status: response.status, headers });
}
export default {
  async scheduled(controller, env, ctx) {
    const cutoff = Date.parse(env.COST_APPROVAL_EXPIRES_AT);
    if (!Number.isFinite(cutoff) || Date.now() >= cutoff) return;
    ctx.waitUntil(fetch(`${env.API_BASE}/internal/gallery/maintenance`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.CLAIM_SECRET}` },
      body: JSON.stringify({ limit: 10 }), signal: AbortSignal.timeout(30_000),
    }).then(response => { if (!response.ok) throw new Error("Gallery maintenance needs attention"); }));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").includes(origin);
    const respond = response => {
      const headers = new Headers(response.headers);
      if (origin && allowed) { headers.set("Access-Control-Allow-Origin", origin); headers.set("Vary", "Origin"); }
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, { status: response.status, headers });
    };
    if (url.pathname === "/ready" && request.method === "GET") return respond(json({ status: "ok" }));
    if (origin && !allowed) return respond(fail(403, "ORIGIN_NOT_ALLOWED", "This origin is not allowed"));
    if (request.method === "OPTIONS") return respond(new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Gallery-Ticket", "Access-Control-Max-Age": "600",
    } }));
    const cutoff = Date.parse(env.COST_APPROVAL_EXPIRES_AT);
    if (!Number.isFinite(cutoff) || Date.now() >= cutoff) return respond(fail(503, "COST_REVIEW_REQUIRED", "The gallery is paused until its free allowance is checked"));
    try {
      if (url.pathname === "/upload") return respond(await upload(request, env));
      if (url.pathname === "/internal/storage") return respond(await internalStorage(request, env));
      if (url.pathname.startsWith("/images/")) return respond(await deliver(request, env, ctx, url));
      return respond(fail(404, "NOT_FOUND", "Endpoint not found"));
    } catch {
      // Never include request URLs, capabilities, secrets or storage keys in logs.
      return respond(fail(503, "GALLERY_UNAVAILABLE", "The gallery is temporarily unavailable. Please retry."));
    }
  },
};

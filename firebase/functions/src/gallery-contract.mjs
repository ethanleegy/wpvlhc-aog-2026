export const EVENT = "gala-2026";
export const VARIANTS = ["thumbnail", "display"];
export const LIMITS = Object.freeze({
  thumbnailBytes: 50_000, displayBytes: 500_000,
  thumbnailEdge: 400, displayEdge: 1600,
  sourceBytes: 30_000_000, sourcePixels: 50_000_000,
  guestPhotos: 20, eventPhotos: 5000, guestEventPhotos: 3000,
  adminReservePhotos: 2000, storageBytes: 6_000_000_000,
  monthlyWrites: 100_000, monthlyReads: 100_000,
  ticketSeconds: 600, viewSeconds: 300,
});
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid capability");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
}
async function key(secret) {
  if (typeof secret !== "string" || encoder.encode(secret).length < 32) throw new Error("Gallery signing key is unavailable");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signCapability(secret, payload) {
  const encoded = encode(encoder.encode(JSON.stringify({ ...payload, aud: "wpvlhc-gallery-v1" })));
  return `${encoded}.${encode(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(encoded))))}`;
}
export async function verifyCapability(secret, token, purpose, now = Date.now()) {
  if (typeof token !== "string" || token.length > 4096) throw new Error("Invalid capability");
  const parts = token.split(".");
  if (parts.length !== 2 || !await crypto.subtle.verify("HMAC", await key(secret), decode(parts[1]), encoder.encode(parts[0]))) throw new Error("Invalid capability");
  const payload = JSON.parse(decoder.decode(decode(parts[0])));
  if (payload.aud !== "wpvlhc-gallery-v1" || payload.purpose !== purpose || !Number.isSafeInteger(payload.exp) || payload.exp <= Math.floor(now / 1000)) throw new Error("Expired or invalid capability");
  return payload;
}

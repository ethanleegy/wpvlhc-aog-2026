import { LIMITS } from "../../firebase/functions/src/gallery-contract.mjs";

function canvas(width, height) {
  const element = typeof document === "undefined" ? new OffscreenCanvas(width, height) : document.createElement("canvas");
  element.width = width; element.height = height;
  return element;
}
const toBlob = (element, type, quality) => element.convertToBlob
  ? element.convertToBlob({ type, quality })
  : new Promise((resolve, reject) => element.toBlob(blob => blob ? resolve(blob) : reject(new Error("Unable to compress this photo")), type, quality));
async function decode(blob) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(blob, { imageOrientation: "from-image", colorSpaceConversion: "default" }); } catch {}
  }
  if (typeof document !== "undefined") {
    const url = URL.createObjectURL(blob), image = new Image();
    try { image.src = url; await image.decode(); return image; }
    finally { URL.revokeObjectURL(url); }
  }
  throw new Error("This device cannot open this photo format");
}
async function source(file) {
  try { return await decode(file); }
  catch (failure) {
    const prefix = new TextDecoder().decode(await file.slice(0, 64).arrayBuffer());
    if (!/heic|heif/i.test(file.type + file.name) && !/ftyp(heic|heix|hevc|hevx|mif1|msf1)/.test(prefix)) throw failure;
    const { heicTo } = typeof document === "undefined" ? await import("heic-to/next") : await import("heic-to/csp");
    try { return await decode(await heicTo({ blob: file, type: "image/jpeg", quality: 0.95 })); }
    catch { throw new Error("This HEIC photo could not be opened on your device. Please choose a JPEG export."); }
  }
}
async function variant(image, longEdge, maxBytes, targetBytes) {
  const originalWidth = image.width || image.naturalWidth, originalHeight = image.height || image.naturalHeight;
  let best;
  for (let resize = 0; resize < 3; resize++) {
    const ratio = Math.min(1, longEdge * (0.82 ** resize) / Math.max(originalWidth, originalHeight));
    const width = Math.max(1, Math.round(originalWidth * ratio)), height = Math.max(1, Math.round(originalHeight * ratio));
    const element = canvas(width, height), context = element.getContext("2d", { alpha: false, colorSpace: "srgb" });
    if (!context) throw new Error("Photo compression is unavailable on this device");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height);
    try {
      for (const quality of [0.82, 0.74, 0.66, 0.58, 0.50, 0.44]) {
        let blob = await toBlob(element, "image/webp", quality);
        if (blob.type !== "image/webp") blob = await toBlob(element, "image/jpeg", quality);
        if (!["image/jpeg", "image/webp"].includes(blob.type)) throw new Error("This browser cannot create compressed photo uploads");
        if (blob.size <= maxBytes && (!best || blob.size > best.blob.size)) best = { blob, width, height };
        if (blob.size <= targetBytes) return { blob, width, height };
      }
    } finally { element.width = 1; element.height = 1; }
    if (best) return best;
  }
  throw new Error("This photo cannot meet the sharing size limit without losing too much quality");
}
export async function compressPhoto(file) {
  if (!file.size || file.size > LIMITS.sourceBytes) throw new Error("Choose a photo smaller than 30 MB");
  if (/\.(gif|svg|avif|raw|cr2|cr3|nef|arw|dng|tiff?|mp4|mov)$/i.test(file.name)) throw new Error("Choose a still JPEG, PNG, WebP or HEIC photo");
  // Reject animation containers even when a misleading filename is supplied.
  const header = new Uint8Array(await file.slice(0, 500_000).arrayBuffer());
  const text = new TextDecoder("latin1").decode(header);
  if (/^GIF8/.test(text) || (text.startsWith("RIFF") && /ANIM|ANMF/.test(text)) || (text.startsWith("\x89PNG") && text.includes("acTL")) || /^\s*<svg/i.test(text)) throw new Error("Animated images and SVG files are not supported");
  const image = await source(file);
  try {
    if ((image.width || image.naturalWidth) * (image.height || image.naturalHeight) > LIMITS.sourcePixels) throw new Error("This photo is larger than 50 megapixels. Please choose a smaller export.");
    const display = await variant(image, LIMITS.displayEdge, LIMITS.displayBytes, 300_000);
    const thumbnail = await variant(image, LIMITS.thumbnailEdge, LIMITS.thumbnailBytes, 40_000);
    for (const item of [display, thumbnail]) {
      const checked = await decode(item.blob);
      try { if ((checked.width || checked.naturalWidth) !== item.width || (checked.height || checked.naturalHeight) !== item.height) throw new Error("Unable to verify the compressed photo"); }
      finally { checked.close?.(); }
      item.sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await item.blob.arrayBuffer())), b => b.toString(16).padStart(2, "0")).join("");
      item.bytes = item.blob.size; item.mimeType = item.blob.type;
    }
    return { display, thumbnail };
  } finally { image.close?.(); }
}

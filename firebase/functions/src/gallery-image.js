const { createHash } = require("node:crypto");
const { ApiError } = require("./errors");
function invalid(message = "This photo is not a supported, metadata-free still image") {
  throw new ApiError(422, "INVALID_PHOTO", message);
}
function jpegDimensions(data) {
  if (data.length < 8 || data.readUInt16BE(0) !== 0xffd8 || data.readUInt16BE(data.length - 2) !== 0xffd9) invalid();
  let cursor = 2, dimensions;
  while (cursor < data.length - 2) {
    if (data[cursor++] !== 0xff) invalid();
    while (data[cursor] === 0xff) cursor++;
    const marker = data[cursor++];
    if (marker === 0xda) break;
    if (marker === 0xd9 || cursor + 2 > data.length) invalid();
    const length = data.readUInt16BE(cursor);
    if (length < 2 || cursor + length > data.length) invalid();
    if ([0xe1, 0xed, 0xfe].includes(marker)) invalid("Remove photo metadata by sharing it through the gallery uploader");
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || dimensions) invalid();
      dimensions = { width: data.readUInt16BE(cursor + 5), height: data.readUInt16BE(cursor + 3) };
    }
    cursor += length;
  }
  if (!dimensions) invalid();
  return dimensions;
}
function webpDimensions(data) {
  if (data.length < 20 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP" || data.readUInt32LE(4) + 8 !== data.length) invalid();
  let cursor = 12, dimensions, extended;
  while (cursor + 8 <= data.length) {
    const kind = data.toString("ascii", cursor, cursor + 4), size = data.readUInt32LE(cursor + 4), start = cursor + 8;
    if (start + size > data.length || ["EXIF", "XMP ", "ANIM", "ANMF"].includes(kind)) invalid();
    if (kind === "VP8X") {
      if (size !== 10 || data[start] & 0x0e) invalid();
      extended = { width: data.readUIntLE(start + 4, 3) + 1, height: data.readUIntLE(start + 7, 3) + 1 };
    }
    if (kind === "VP8 ") {
      if (dimensions || size < 10 || data.toString("hex", start + 3, start + 6) !== "9d012a") invalid();
      dimensions = { width: data.readUInt16LE(start + 6) & 0x3fff, height: data.readUInt16LE(start + 8) & 0x3fff };
    }
    if (kind === "VP8L") {
      if (dimensions || size < 5 || data[start] !== 0x2f) invalid();
      const packed = data.readUInt32LE(start + 1);
      dimensions = { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
    }
    cursor = start + size + (size % 2);
  }
  if (cursor !== data.length || !dimensions || (extended && (extended.width !== dimensions.width || extended.height !== dimensions.height))) invalid();
  return dimensions;
}
function verifyImage(data, expected, variant) {
  const maxBytes = variant === "thumbnail" ? 50_000 : 500_000;
  const maxEdge = variant === "thumbnail" ? 400 : 1600;
  if (!Buffer.isBuffer(data) || data.length < 1 || data.length > maxBytes || data.length !== expected.bytes || createHash("sha256").update(data).digest("hex") !== expected.sha256) invalid("The uploaded photo does not match its authorized size or checksum");
  const dimensions = expected.mimeType === "image/jpeg" ? jpegDimensions(data) : expected.mimeType === "image/webp" ? webpDimensions(data) : invalid();
  if (!dimensions.width || !dimensions.height || Math.max(dimensions.width, dimensions.height) > maxEdge || dimensions.width !== expected.width || dimensions.height !== expected.height) invalid("The photo dimensions do not match the compressed upload");
  return { ...dimensions, bytes: data.length, mimeType: expected.mimeType, sha256: expected.sha256 };
}
module.exports = { verifyImage, jpegDimensions, webpDimensions };

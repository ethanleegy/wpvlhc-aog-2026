const { ApiError } = require("./errors");
function createGalleryStorage(config, reserve) {
  async function command(action, source, target) {
    await reserve(action === "copy" ? 1 : 0, action === "delete" ? 0 : 1);
    let response;
    try {
      // No automatic retry: a timed-out attempt remains counted.
      response = await fetch(`${config.workerUrl}/internal/storage`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.internalSecret}` },
        body: JSON.stringify({ action, source, ...(target ? { target } : {}) }), signal: AbortSignal.timeout(8000),
      });
    } catch { throw new ApiError(503, "STORAGE_UNAVAILABLE", "Photo storage is temporarily unavailable. Please retry."); }
    if (response.status === 404) throw new ApiError(409, "UPLOAD_INCOMPLETE", "The photo has not finished uploading. Please retry.");
    if (!response.ok) throw new ApiError(503, "STORAGE_UNAVAILABLE", "Photo storage is temporarily unavailable. Please retry.");
    if (action !== "read") return;
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 500_000) { await response.body.cancel().catch(() => {}); throw new ApiError(422, "INVALID_PHOTO", "Photo exceeds the permitted size"); }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  return { read: ref => command("read", ref), copy: (source, target) => command("copy", source, target), delete: ref => command("delete", ref) };
}
module.exports = { createGalleryStorage };

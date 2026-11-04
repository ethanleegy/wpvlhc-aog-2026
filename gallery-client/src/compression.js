let active = Promise.resolve();
export function compressPhoto(file) {
  const run = async () => {
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
      return (await import("./encode.js")).compressPhoto(file);
    }
    const worker = new Worker(new URL("./compression-worker.js", import.meta.url), { type: "module" });
    try {
      return await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.result);
        worker.onerror = () => reject(new Error("Unable to prepare this photo on your device"));
        worker.postMessage({ file });
      });
    } finally { worker.terminate(); }
  };
  const result = active.then(run, run);
  active = result.catch(() => {});
  return result;
}

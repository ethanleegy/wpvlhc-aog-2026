import { compressPhoto } from "./encode.js";
self.onmessage = async event => {
  try { self.postMessage({ result: await compressPhoto(event.data.file) }); }
  catch (error) { self.postMessage({ error: error.message || "Unable to prepare this photo" }); }
};

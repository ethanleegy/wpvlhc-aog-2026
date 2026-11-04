const Joi = require("joi");
const hexId = Joi.string().pattern(/^[a-f0-9]{32}$/);
const requestId = Joi.string().pattern(/^[A-Za-z0-9_-]{8,80}$/);
const variant = (maxBytes, maxEdge) => Joi.object({
  mimeType: Joi.string().valid("image/jpeg", "image/webp").required(),
  bytes: Joi.number().integer().min(1).max(maxBytes).required(),
  width: Joi.number().integer().min(1).max(maxEdge).required(),
  height: Joi.number().integer().min(1).max(maxEdge).required(),
  sha256: Joi.string().pattern(/^[a-f0-9]{64}$/).required(),
}).required();
const capability = Joi.string().min(30).max(4096);
const file = Joi.object({
  itemId: requestId.required(), fileName: Joi.string().max(160).required(),
  thumbnail: variant(50_000, 400), display: variant(500_000, 1600),
});
const schemas = {
  session: Joi.object({ turnstileToken: Joi.string().max(2048).allow("").default("") }),
  guestUploads: Joi.object({ requestId: requestId.required(), sessionToken: capability.required(), files: Joi.array().items(file).min(1).max(20).unique("itemId").required() }),
  adminUploads: Joi.object({ requestId: requestId.required(), batchId: hexId.required(), files: Joi.array().items(file).min(1).max(20).unique("itemId").required() }),
  guestComplete: Joi.object({ completionToken: capability.required() }),
  photo: Joi.object({ photoId: hexId.required() }),
  claim: Joi.object({ ticket: capability.required() }),
  receipt: Joi.object({ ticket: capability.required(), outcome: Joi.string().valid("stored", "failed").required() }),
  settings: Joi.object({ requireApproval: Joi.boolean(), guestUploadsOpen: Joi.boolean(), adminUploadsOpen: Joi.boolean() }).min(1),
  batch: Joi.object({ requestId: requestId.required(), publication: Joi.string().valid("follow", "publish", "review").default("follow") }),
  list: Joi.object({ limit: Joi.number().integer().min(1).max(100).default(20), after: hexId, status: Joi.string().valid("visible", "hidden", "pending", "failed", "all").default("all"), batchId: hexId }),
  publicList: Joi.object({ limit: Joi.number().integer().min(1).max(50).default(20), after: hexId }),
  actions: Joi.object({ action: Joi.string().valid("show", "hide").required(), photoIds: Joi.array().items(hexId).min(1).max(25).unique().required() }),
  maintenance: Joi.object({ limit: Joi.number().integer().min(1).max(25).default(10) }),
};
module.exports = { gallerySchemas: schemas };

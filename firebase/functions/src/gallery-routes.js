const { input } = require("./validation");
const { gallerySchemas: s } = require("./gallery-validation");
const { createGalleryService } = require("./gallery-service");
const { rateLimit } = require("./auth");
const { ApiError } = require("./errors");

function galleryRoutes(api, admin, { getDb, storageFactory }) {
  const service = res => createGalleryService(getDb(), res.locals.config, storageFactory);
  api.get("/gallery/policy", async (req, res) => res.json(await service(res).policy()));
  api.post("/gallery/sessions", input(s.session), async (req, res) => {
    await rateLimit(getDb(), `gallery-session:${req.ip}`, 500);
    res.status(201).json(await service(res).createSession(res.locals.body.turnstileToken, req.ip));
  });
  api.post("/gallery/uploads", input(s.guestUploads), async (req, res) => res.status(201).json(await service(res).authorize(res.locals.body, "guest")));
  api.post("/gallery/uploads/:photoId/complete", input(s.photo, "params"), input(s.guestComplete), async (req, res) => res.json(await service(res).complete(res.locals.params.photoId, res.locals.body.completionToken)));
  api.post("/gallery/uploads/:photoId/status", input(s.photo, "params"), input(s.guestComplete), async (req, res) => res.json(await service(res).status(res.locals.params.photoId, res.locals.body.completionToken)));
  api.post("/gallery/uploads/:photoId/retry", input(s.photo, "params"), input(s.guestComplete), async (req, res) => res.json(await service(res).retry(res.locals.params.photoId, res.locals.body.completionToken)));
  api.get("/gallery/photos", input(s.publicList, "query"), async (req, res) => res.json(await service(res).list(res.locals.query)));
  api.get("/gallery/photos/:photoId", input(s.photo, "params"), async (req, res) => res.json(await service(res).detail(res.locals.params.photoId)));
  api.post("/internal/gallery/upload-claims", input(s.claim), async (req, res) => {
    res.json(await service(res).claim(res.locals.body.ticket, (req.get("Authorization") || "").replace(/^Bearer /, "")));
  });
  api.post("/internal/gallery/upload-results", input(s.receipt), async (req, res) => res.json(await service(res).receipt(res.locals.body.ticket, res.locals.body.outcome, (req.get("Authorization") || "").replace(/^Bearer /, ""))));
  api.post("/internal/gallery/maintenance", input(s.maintenance), async (req, res) => res.json(await service(res).internalMaintenance(res.locals.body.limit, (req.get("Authorization") || "").replace(/^Bearer /, ""))));
  admin.get("/gallery/settings", async (req, res) => res.json(await service(res).settings()));
  admin.patch("/gallery/settings", input(s.settings), async (req, res) => res.json(await service(res).patchSettings(res.locals.body, res.locals.admin.username)));
  admin.post("/gallery/batches", input(s.batch), async (req, res) => res.status(201).json(await service(res).createBatch(res.locals.body, res.locals.admin.username)));
  admin.post("/gallery/uploads", input(s.adminUploads), async (req, res) => res.status(201).json(await service(res).authorize(res.locals.body, "admin", res.locals.admin.username)));
  admin.post("/gallery/uploads/:photoId/complete", input(s.photo, "params"), input(require("./validation").schemas.empty), async (req, res) => res.json(await service(res).complete(res.locals.params.photoId, null, true)));
  admin.post("/gallery/uploads/:photoId/retry", input(s.photo, "params"), input(require("./validation").schemas.empty), async (req, res) => res.json(await service(res).retry(res.locals.params.photoId, null, true)));
  admin.get("/gallery/photos", input(s.list, "query"), async (req, res) => res.json(await service(res).list(res.locals.query, true)));
  admin.get("/gallery/photos/:photoId", input(s.photo, "params"), async (req, res) => res.json(await service(res).detail(res.locals.params.photoId, true)));
  admin.post("/gallery/actions", input(s.actions), async (req, res) => res.json(await service(res).moderate(res.locals.body.photoIds, res.locals.body.action, res.locals.admin.username)));
  admin.post("/gallery/maintenance", input(s.maintenance), async (req, res) => res.json(await service(res).maintenance(res.locals.body.limit)));
}
module.exports = { galleryRoutes };

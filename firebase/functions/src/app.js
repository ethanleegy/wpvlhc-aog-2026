const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { randomUUID } = require("node:crypto");
const { ApiError } = require("./errors");
const { schemas, input } = require("./validation");
const { createService } = require("./service");
const {
  COOKIE,
  cookieOptions,
  login,
  authenticate,
  rateLimit,
} = require("./auth");
const { guestCsv, foodCsv } = require("./csv");

function createApp({ getDb, getConfig, logger = console }) {
  const app = express();
  app.disable("x-powered-by");
  // Cloud Functions supplies req.ip through Express; never trust arbitrary forwarded IPs.
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.set({
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Request-Id": res.locals.requestId,
    });
    next();
  });
  app.get("/v1/ready", (req, res) => res.json({ status: "ok", version: "1" }));
  app.use((req, res, next) => {
    try {
      res.locals.config = getConfig();
      cors({
        credentials: true,
        methods: ["GET", "POST", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "X-Admin-Request"],
        origin(origin, callback) {
          if (!origin || res.locals.config.origins.includes(origin))
            callback(null, true);
          else
            callback(
              new ApiError(
                403,
                "ORIGIN_NOT_ALLOWED",
                "This origin is not allowed",
              ),
            );
        },
      })(req, res, next);
    } catch (error) {
      next(error);
    }
  });
  app.use(express.json({ limit: "32kb", strict: true }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    if (["POST", "PATCH"].includes(req.method) && !req.is("application/json"))
      return next(
        new ApiError(
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Use Content-Type: application/json",
        ),
      );
    res.locals.service = createService(getDb(), res.locals.config);
    next();
  });

  const api = express.Router();
  api.get(
    "/token/:token/status",
    input(schemas.token, "params"),
    async (req, res) => {
      const guest = await res.locals.service.publicGuest(
        res.locals.params.token,
      );
      res.json({
        token: guest.token,
        name: guest.name,
        personalizedName: guest.personalizedName,
        valid: true,
        rsvp: guest.rsvp,
        respondedAt: guest.respondedAt,
      });
    },
  );
  api.get("/token/:token", input(schemas.token, "params"), async (req, res) =>
    res.json(await res.locals.service.publicGuest(res.locals.params.token)),
  );
  api.get("/food-items", async (req, res) => {
    const items = await res.locals.service.listFoods(true);
    res.json({
      foodItems: items.map(({ id, name, description, unit }) => ({
        id,
        name,
        description,
        unit,
      })),
    });
  });
  api.post(
    "/token/:token/reply",
    input(schemas.token, "params"),
    input(schemas.reply),
    async (req, res) => {
      await rateLimit(getDb(), `reply:${res.locals.params.token}`, 60);
      res.json(
        await res.locals.service.saveReply(
          res.locals.params.token,
          res.locals.body,
        ),
      );
    },
  );

  const admin = express.Router();
  admin.use((req, res, next) => {
    if (
      ["POST", "PATCH"].includes(req.method) &&
      req.get("X-Admin-Request") !== "true"
    ) {
      return next(
        new ApiError(
          403,
          "ADMIN_HEADER_REQUIRED",
          "Send X-Admin-Request: true",
        ),
      );
    }
    next();
  });
  admin.post("/login", input(schemas.login), async (req, res) => {
    await rateLimit(getDb(), `login:${req.ip}`, 10);
    res.json(await login(res.locals.config, res.locals.body, res));
  });
  admin.use((req, res, next) => {
    try {
      res.locals.admin = authenticate(res.locals.config, req);
      next();
    } catch (error) {
      next(error);
    }
  });
  admin.get("/session", (req, res) => res.json(res.locals.admin));
  admin.post("/logout", input(schemas.empty), (req, res) => {
    res.clearCookie(COOKIE, cookieOptions(res.locals.config));
    res.status(204).end();
  });
  admin.get("/churches", async (req, res) =>
    res.json({ churches: await res.locals.service.listChurches() }),
  );
  admin.post("/churches", input(schemas.churchCreate), async (req, res) =>
    res
      .status(201)
      .json(await res.locals.service.createChurch(res.locals.body)),
  );
  admin.patch(
    "/churches/:id",
    input(schemas.id, "params"),
    input(schemas.churchPatch),
    async (req, res) =>
      res.json(
        await res.locals.service.patchChurch(
          res.locals.params.id,
          res.locals.body,
        ),
      ),
  );
  admin.get("/food-items", async (req, res) =>
    res.json({ foodItems: await res.locals.service.listFoods() }),
  );
  admin.post("/food-items", input(schemas.foodCreate), async (req, res) =>
    res.status(201).json(await res.locals.service.createFood(res.locals.body)),
  );
  admin.patch(
    "/food-items/:id",
    input(schemas.id, "params"),
    input(schemas.foodPatch),
    async (req, res) =>
      res.json(
        await res.locals.service.patchFood(
          res.locals.params.id,
          res.locals.body,
        ),
      ),
  );
  admin.get("/guests", input(schemas.list, "query"), async (req, res) =>
    res.json(await res.locals.service.listGuests(res.locals.query)),
  );
  admin.post("/guests", input(schemas.guestCreate), async (req, res) =>
    res.status(201).json(await res.locals.service.createGuest(res.locals.body)),
  );
  admin.get("/guests/:id", input(schemas.guestId, "params"), async (req, res) =>
    res.json(await res.locals.service.getGuest(res.locals.params.id)),
  );
  admin.patch(
    "/guests/:id",
    input(schemas.guestId, "params"),
    input(schemas.guestPatch),
    async (req, res) =>
      res.json(
        await res.locals.service.patchGuest(
          res.locals.params.id,
          res.locals.body,
        ),
      ),
  );
  admin.post(
    "/guests/:id/reply",
    input(schemas.guestId, "params"),
    input(schemas.reply),
    async (req, res) =>
      res.json(
        await res.locals.service.saveReply(
          res.locals.params.id,
          res.locals.body,
          true,
        ),
      ),
  );
  admin.get(
    "/reports/summary",
    input(schemas.report, "query"),
    async (req, res) => {
      const { guests, ...report } = await res.locals.service.report(
        res.locals.query.churchId,
      );
      res.json(report);
    },
  );
  for (const [path, filename, formatter] of [
    ["guests.csv", "gala-guests.csv", guestCsv],
    ["food.csv", "gala-food.csv", foodCsv],
  ]) {
    admin.get(
      `/reports/${path}`,
      input(schemas.report, "query"),
      async (req, res) => {
        const report = await res.locals.service.report(
          res.locals.query.churchId,
        );
        res
          .set("Content-Disposition", `attachment; filename="${filename}"`)
          .type("text/csv")
          .send(formatter(report));
      },
    );
  }
  api.use("/admin", admin);
  app.use("/v1", api);
  app.use((req, res, next) =>
    next(new ApiError(404, "NOT_FOUND", "Endpoint not found")),
  );
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let failure = error;
    if (error instanceof URIError && error.status === 400)
      failure = new ApiError(
        400,
        "VALIDATION_ERROR",
        "The URL path is malformed",
      );
    if (error.type === "entity.parse.failed")
      failure = new ApiError(
        400,
        "INVALID_JSON",
        "The request body is not valid JSON",
      );
    if (error.type === "entity.too.large")
      failure = new ApiError(
        413,
        "PAYLOAD_TOO_LARGE",
        "The request body exceeds 32 KB",
      );
    if (!(failure instanceof ApiError)) {
      // Never log request URLs, cookies, passwords or raw Firestore errors containing invitation codes.
      logger.error("API request failed", {
        requestId: res.locals.requestId,
        errorType: error.name || "Error",
      });
      failure = new ApiError(
        500,
        "INTERNAL_ERROR",
        "The request could not be completed. Please try again.",
      );
    }
    if (failure.status === 429) res.set("Retry-After", "900");
    res.status(failure.status).json({
      error: {
        code: failure.code,
        message: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
        requestId: res.locals.requestId,
      },
    });
  });
  return app;
}
module.exports = { createApp };

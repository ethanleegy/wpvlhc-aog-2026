const path = require("node:path");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const SwaggerParser = require("@apidevtools/swagger-parser");
const backendRequire = createRequire(
  path.resolve(__dirname, "../functions/package.json"),
);
const { createApp } = backendRequire("./src/app");
const methods = ["get", "post", "patch", "put", "delete", "options", "head"];

// Inspect the registered Express 5 routes, including the two CSV routes built
// in a loop. Providers must not run: this check needs no credentials/database.
function registeredRoutes(stack, prefix = "") {
  return stack.flatMap((layer) => {
    if (layer.route) {
      const route = `${prefix}${layer.route.path}`
        .replace(/^\/v1(?=\/)/, "")
        .replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      return Object.keys(layer.route.methods).map(
        (method) => `${method.toUpperCase()} ${route}`,
      );
    }
    if (!layer.handle?.stack) return [];
    const mounts = ["/v1", "/admin"].filter((mount) =>
      layer.matchers.some((match) => Boolean(match(mount))),
    );
    assert.equal(
      mounts.length,
      1,
      "Update API route inspection for the new router mount",
    );
    return registeredRoutes(layer.handle.stack, `${prefix}${mounts[0]}`);
  });
}

async function main() {
  const filename = path.resolve(__dirname, "../../api-spec/openapi.json");
  const api = await SwaggerParser.validate(filename);
  const operations = Object.entries(api.paths).flatMap(([route, item]) =>
    Object.entries(item)
      .filter(([method]) => methods.includes(method))
      .map(([method, operation]) => ({
        route: `${method.toUpperCase()} ${route}`,
        id: operation.operationId,
      })),
  );
  const unavailable = () => {
    throw new Error("Spec checks must not access secrets or a database");
  };
  const app = createApp({ getDb: unavailable, getConfig: unavailable });
  assert.deepEqual(
    operations.map((operation) => operation.route).sort(),
    registeredRoutes(app.router.stack).sort(),
    "OpenAPI paths must match every registered backend route",
  );
  assert.ok(
    operations.every((operation) => operation.id),
    "Every operation needs an operationId",
  );
  assert.equal(
    new Set(operations.map((operation) => operation.id)).size,
    operations.length,
    "operationId values must be unique",
  );
  console.log(
    `OpenAPI ${api.openapi} is valid: all ${operations.length} operations match the backend routes.`,
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

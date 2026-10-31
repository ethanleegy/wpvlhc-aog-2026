const path = require("node:path");
const SwaggerParser = require("@apidevtools/swagger-parser");

async function main() {
  const filename = path.resolve(__dirname, "../../api-spec/openapi.json");
  const api = await SwaggerParser.validate(filename);
  const operations = Object.values(api.paths).reduce(
    (count, item) =>
      count +
      Object.keys(item).filter((method) =>
        ["get", "post", "patch"].includes(method),
      ).length,
    0,
  );
  console.log(
    `OpenAPI ${api.openapi} is valid: ${operations} documented operations.`,
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

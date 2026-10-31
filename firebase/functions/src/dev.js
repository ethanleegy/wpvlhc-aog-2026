const { createApp } = require("./app");
const { loadConfig } = require("./config");
const { getDb } = require("./firestore");
const config = loadConfig();
if (!config.local)
  throw new Error(
    "The local server requires LOCAL_DEVELOPMENT=true and FIRESTORE_EMULATOR_HOST",
  );
const port = Number(process.env.PORT || 5999);
createApp({ getDb, getConfig: () => config }).listen(port, "127.0.0.1", () =>
  console.log(`API available at http://127.0.0.1:${port}/v1`),
);

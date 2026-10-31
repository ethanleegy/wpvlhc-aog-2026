const readline = require("node:readline/promises");
const { Writable } = require("node:stream");
const bcrypt = require("bcryptjs");

async function main() {
  if (!process.stdin.isTTY)
    throw new Error("Run this in an interactive terminal");
  const silent = new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });
  const prompt = readline.createInterface({
    input: process.stdin,
    output: silent,
    terminal: true,
  });
  let password;
  try {
    process.stdout.write("Admin password (hidden): ");
    password = await prompt.question("");
  } finally {
    prompt.close();
    process.stdout.write("\n");
  }
  if (password.length < 12 || Buffer.byteLength(password) > 72)
    throw new Error("Use at least 12 characters and at most 72 UTF-8 bytes");
  console.log(bcrypt.hashSync(password, 12));
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

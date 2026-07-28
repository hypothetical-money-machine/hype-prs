import { readFile } from "node:fs/promises";

const configUrl = new URL("./config/github.json", import.meta.url);
const config = JSON.parse(await readFile(configUrl, "utf8"));
const clientId =
  typeof config.githubAppClientId === "string"
    ? config.githubAppClientId.trim()
    : "";

if (!clientId && process.env.HYPE_ALLOW_UNCONFIGURED_BUILD !== "1") {
  console.error(
    "Electron packaging requires electron/config/github.json to contain the public GitHub App client ID. Use npm run electron:pack:demo only for an unconfigured demo artifact.",
  );
  process.exitCode = 1;
}

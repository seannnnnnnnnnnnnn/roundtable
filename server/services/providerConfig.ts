import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, providerView } from "../db.js";
import { nowIso } from "../utils.js";
import { ProviderUnavailableError } from "./llmGateway.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const envPath = process.env.ROUND_TABLE_ENV_PATH || path.join(rootDir, ".env");

export function configureProvider(input: {
  providerId: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
}) {
  const provider = db
    .prepare("SELECT * FROM model_providers WHERE id = ?")
    .get(input.providerId) as any;
  if (!provider || provider.provider === "mock") {
    throw new Error("该 Provider 不可配置。");
  }

  const keyRef = String(provider.api_key_ref || "");
  if (!/^[A-Z][A-Z0-9_]*$/.test(keyRef)) {
    throw new Error("Provider 的环境变量名无效。");
  }

  const nextKey = input.apiKey?.trim();
  if (nextKey) {
    persistEnvValue(keyRef, nextKey);
    process.env[keyRef] = nextKey;
  }
  if (!process.env[keyRef]) {
    throw new ProviderUnavailableError("请填写 API Key 后再保存。");
  }

  db.prepare(
    `UPDATE model_providers
     SET base_url = ?, model = ?, status = 'active', updated_at = ?
     WHERE id = ?`
  ).run(input.baseUrl.replace(/\/$/, ""), input.model, nowIso(), input.providerId);

  return providerView(
    db.prepare("SELECT * FROM model_providers WHERE id = ?").get(input.providerId)
  );
}

function persistEnvValue(name: string, value: string) {
  const original = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const nextLine = `${name}=${JSON.stringify(value)}`;
  const lines = original.split(/\r?\n/);
  const index = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (index >= 0) lines[index] = nextLine;
  else {
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    lines.push(nextLine);
  }

  const content = `${lines.join("\n").replace(/\n+$/, "")}\n`;
  const temporary = `${envPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, envPath);
  fs.chmodSync(envPath, 0o600);
}

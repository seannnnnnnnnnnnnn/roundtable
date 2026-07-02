import { createHash, randomUUID } from "node:crypto";

export function id(prefix: string) {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function toJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

export function fromJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

export function compactText(value: string, max = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

export function pickFirstText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
}

import { z } from "zod";
import type { OperationMode as OperationModeValue } from "@/components/operation-mode-picker";

export interface SetupStatus {
  setupComplete: boolean;
  prowlarrConfig: { host: string | null; configured: boolean };
  proxyDefaults: { port: number; username: string; portEnvManaged: boolean };
  // Resolved legacy-API port (env override > default). The proxy port lives in
  // proxyDefaults.port; this carries the second port the mode picker displays.
  legacyApiPort: number;
}

export type TmdbTestResult =
  | { ok: true; sample: { id: number; title: string } }
  | {
      ok: false;
      code: "missing" | "v4_token" | "invalid_format" | "unauthorized" | "network" | "unknown";
      detail?: string;
    };

export type TvdbTestResult =
  | { ok: true; sample: { id: number; title: string } }
  | {
      ok: false;
      code: "missing" | "unauthorized" | "network" | "unknown";
      detail?: string;
    };

export interface InstallProxyPreview {
  defaultHost: string;
  port: number;
  username: string;
  name: string;
  tagLabel: string;
  existing: { id: number } | null;
}

export interface ProwlarrConnectionTestResult {
  ok: boolean;
  message: string;
}

export const AdminSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/),
  password: z.string().min(8).max(256),
  tmdbApiKey: z.string().max(256).optional().nullable(),
  tvdbApiKey: z.string().max(256).optional().nullable(),
  tvdbPin: z.string().max(64).optional().nullable(),
});
export type AdminFormInput = z.infer<typeof AdminSchema>;

export const ProwlarrCredsForm = z.object({
  host: z
    .string()
    .url()
    .refine((v) => /^https?:\/\//i.test(v)),
  apiKey: z.string().min(8).max(128),
});
export type ProwlarrFormInput = z.infer<typeof ProwlarrCredsForm>;

export const ProxySchema = z.object({
  proxyUsername: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[^:\s]+$/),
  proxyPassword: z.string().min(8).max(128),
});
export type ProxyFormInput = z.infer<typeof ProxySchema>;

export type Step =
  | "admin"
  | "mode"
  | "plugins"
  | "prowlarr-connect"
  | "prowlarr-import"
  | "proxy"
  | "prowlarr-install"
  | "prowlarr-patch-indexers"
  | "sync";

export type OperationMode = OperationModeValue;

export interface AppRowState {
  apiKey: string;
  status: "untested" | "testing" | "ok" | "fail";
  error?: string | undefined;
  version?: string | undefined;
}

const PASSWORD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generatePassword(length = 24): string {
  if (typeof crypto === "undefined" || !crypto.getRandomValues) {
    // crypto.getRandomValues is present on Node >=24 and all modern browsers
    // we support. Refuse to fall back to Math.random rather than silently
    // generate a weak, predictable password.
    throw new Error("crypto.getRandomValues is unavailable; cannot generate a secure password");
  }
  // Rejection sampling to avoid modulo bias: 256 is not a multiple of 62, so a
  // plain `byte % 62` over-weights the first 256 % 62 = 8 characters. Discard
  // bytes in that uneven top band and only keep the uniform range.
  const n = PASSWORD_ALPHABET.length;
  const limit = Math.floor(256 / n) * n; // largest multiple of n that fits in a byte
  const out: string[] = [];
  const buf = new Uint8Array(length);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= limit) continue;
      out.push(PASSWORD_ALPHABET.charAt(b % n));
      if (out.length === length) break;
    }
  }
  return out.join("");
}

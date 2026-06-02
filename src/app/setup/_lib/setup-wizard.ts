import { z } from "zod";
import type { OperationMode as OperationModeValue } from "@/components/operation-mode-picker";

export interface SetupStatus {
  setupComplete: boolean;
  prowlarrConfig: { host: string | null; configured: boolean };
  proxyDefaults: { port: number; username: string };
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
    let s = "";
    for (let i = 0; i < length; i++) {
      s += PASSWORD_ALPHABET[Math.floor(Math.random() * PASSWORD_ALPHABET.length)];
    }
    return s;
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join("");
}

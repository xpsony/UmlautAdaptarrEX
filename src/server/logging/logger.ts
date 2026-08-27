import pino, { type LoggerOptions, stdSerializers } from "pino";
import { prisma } from "@/lib/db";
import type { LogBroadcaster } from "./broadcast";

// Querystring keys to redact in URLs/log strings. Match `apikey=`, `api_key=`,
// `apiKey=`, `token=`, `password=` (case-insensitive) regardless of position.
const REDACT_RE = /\b(apikey|api[_-]?key|token|password|secret)=[^&\s"]+/gi;
// Authorization-style HTTP header lines.
const HEADER_REDACT_RE =
  /(api[_-]?key|x-api-key|authorization|cookie|set-cookie|proxy-authorization)\s*:\s*\S+/gi;

// Explicit blocklist for full key names - these win regardless of regex match,
// so future fields here are safe even if the heuristic misses.
const SENSITIVE_KEY_LITERALS = new Set(
  [
    "authorization",
    "cookie",
    "set-cookie",
    "proxy-authorization",
    "x-api-key",
    "csrfsecret",
    "csrftoken",
    "sessionid",
    "sessiontoken",
    "password",
    "passwordhash",
    "passwd",
    "pwd",
    "secret",
    "token",
    "apikey",
    "api_key",
    "appapikey",
    "tmdbapikey",
    "prowlarrapikey",
    "proxypassword",
  ].map((k) => k.toLowerCase()),
);

// Word-boundary aware matcher. Detects suffixes that are either separated by
// `_`/`-` or by a camelCase boundary (`tmdbApiKey`, `proxyPassword` →
// `Password`/`ApiKey` follow a lowercase letter and start with uppercase).
// Also detects standalone names (`apiKey`, `password`) and suffix forms.
const SENSITIVE_KEY_RE =
  /(?:^|[_\-]|(?<=[a-z]))(password|passwd|pwd|secret|token|apikey|api[_-]?key)s?(?=$|[_\-A-Z])/i;

function isSensitiveKey(name: string): boolean {
  const lower = name.toLowerCase();
  if (SENSITIVE_KEY_LITERALS.has(lower)) return true;
  return SENSITIVE_KEY_RE.test(name);
}

// Test-only re-export of the redaction logic so unit tests can verify the
// exact behaviour without booting the full logger / DB queue. Renamed to
// avoid accidental import from production code.
export const redactValueForTests = (v: unknown): unknown => redactValue(v);

function redactValue(value: unknown, visited = new WeakSet()): unknown {
  if (typeof value === "string") {
    return value
      .replace(REDACT_RE, (_, k) => `${k}=[REDACTED]`)
      .replace(HEADER_REDACT_RE, "$1: [REDACTED]");
  }
  if (Array.isArray(value)) {
    if (visited.has(value)) {
      return "[CIRCULAR]";
    }
    visited.add(value);
    return value.map((v) => redactValue(v, visited));
  }
  if (value && typeof value === "object") {
    if (visited.has(value)) {
      return "[CIRCULAR]";
    }
    visited.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactValue(v, visited);
      }
    }
    return out;
  }
  return value;
}

export interface LoggerDeps {
  broadcaster?: LogBroadcaster;
}

interface QueuedLog {
  level: string;
  message: string;
  context: string | null;
  createdAt: Date;
}

const QUEUE: QueuedLog[] = [];
let flushTimer: NodeJS.Timeout | null = null;

async function flushQueue(): Promise<void> {
  flushTimer = null;
  if (QUEUE.length === 0) return;
  const batch = QUEUE.splice(0, QUEUE.length);
  try {
    await prisma.logEntry.createMany({ data: batch });
  } catch {
    /* DB unavailable, non-fatal */
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    void flushQueue();
  }, 1000);
}

const VALID_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal", "silent"]);

function resolveLogLevel(isDev: boolean): string {
  const fallback = isDev ? "debug" : "info";
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (!raw) return fallback;
  if (!VALID_LEVELS.has(raw)) {
    // Stderr only: the logger itself isn't constructed yet.
    console.warn(
      `[logger] ignoring invalid LOG_LEVEL=${JSON.stringify(process.env.LOG_LEVEL)}, falling back to "${fallback}"`,
    );
    return fallback;
  }
  return raw;
}

export function createLogger(deps: LoggerDeps = {}): pino.Logger {
  const isDev = process.env.NODE_ENV !== "production";
  const baseOpts: LoggerOptions = {
    level: resolveLogLevel(isDev),
    base: { pid: process.pid },
    serializers: {
      err: stdSerializers.err,
      error: stdSerializers.err,
      // No req/res serializers - per-request hooks log only the relevant fields.
    },
    formatters: {
      log(obj) {
        const r = redactValue(obj);
        return (r && typeof r === "object" && !Array.isArray(r) ? r : { value: r }) as Record<
          string,
          unknown
        >;
      },
    },
    hooks: {
      logMethod(args, method, level) {
        const [arg0, arg1] = args;
        let message: string;
        let context: Record<string, unknown> | null = null;
        if (typeof arg0 === "string") {
          message = arg0;
        } else if (arg0 && typeof arg0 === "object") {
          context = redactValue(arg0) as Record<string, unknown>;
          message = typeof arg1 === "string" ? arg1 : JSON.stringify(context);
        } else {
          message = String(arg0);
        }
        const levelLabel = pino.levels.labels[level] ?? "info";
        const entry: QueuedLog = {
          level: levelLabel,
          message,
          context: context ? JSON.stringify(context) : null,
          createdAt: new Date(),
        };
        QUEUE.push(entry);
        if (QUEUE.length > 5000) QUEUE.splice(0, QUEUE.length - 5000);
        scheduleFlush();
        deps.broadcaster?.broadcast(entry);
        method.apply(this, args as Parameters<typeof method>);
      },
    },
  };

  if (isDev) {
    return pino({
      ...baseOpts,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          // SYS uses the system timezone instead of UTC for console readability.
          translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
        },
      },
    });
  }
  return pino(baseOpts);
}

export type AppLogger = pino.Logger;

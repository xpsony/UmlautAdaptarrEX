import type {FastifyReply} from "fastify";
import {prisma} from "@/lib/db";

interface ProwlarrUpstreamFailure {
    ok: false;
    status?: number;
    error?: string;
}

/**
 * Map a Prowlarr upstream failure to a Fastify reply. 401 stays 401 (so the UI
 * can flag bad creds), everything else maps to a 502 with the supplied
 * `errorCode` (e.g. `"fetch_failed"` or `"install_failed"`).
 */
export function replyProwlarrUpstreamError(
    reply: FastifyReply,
    result: ProwlarrUpstreamFailure,
    errorCode: string,
): FastifyReply {
    return reply.code(result.status === 401 ? 401 : 502).send({
        error: result.status === 401 ? "unauthorized" : errorCode,
        message: result.error,
    });
}

/**
 * Look up persisted Prowlarr credentials. Returns `null` and emits a 409 if
 * none are configured - caller can `if (!creds) return;` and bail.
 */
export async function loadStoredProwlarrCreds(
    reply: FastifyReply,
): Promise<{ host: string; apiKey: string } | null> {
    const setting = await prisma.setting.findUnique({where: {id: 1}});
    if (!setting?.prowlarrHost || !setting?.prowlarrApiKey) {
        reply.code(409).send({
            error: "no_stored_creds",
            message: "No Prowlarr credentials stored.",
        });
        return null;
    }
    return {host: setting.prowlarrHost, apiKey: setting.prowlarrApiKey};
}

/** Upsert persisted Prowlarr creds. `appApiKey` is the create-only fallback. */
export async function persistProwlarrCreds(
    host: string,
    apiKey: string,
    appApiKey: string,
): Promise<void> {
    await prisma.setting.upsert({
        where: {id: 1},
        update: {prowlarrHost: host, prowlarrApiKey: apiKey},
        create: {id: 1, appApiKey, prowlarrHost: host, prowlarrApiKey: apiKey},
    });
}

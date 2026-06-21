import { nanoid } from "nanoid";
import { prisma } from "@/lib/db";

// No "__Host-" prefix — that would require HTTPS+Secure, which self-hosted
// deployments behind home networks often don't have.
export const SESSION_COOKIE = "uaSession";
// Production: 14 days. Dev (NODE_ENV === "development"): 365 days, so a
// single /setup or /login lasts effectively forever during local
// development and DB resets are at most a one-time inconvenience.
//
// Whitelisting "development" (rather than blacklisting "production") means
// an unset NODE_ENV defaults to the strict prod TTL — otherwise a missed
// env var in production would silently extend sessions to a full year.
export const SESSION_TTL_MS =
  process.env.NODE_ENV === "development"
    ? 365 * 24 * 60 * 60 * 1000
    : 14 * 24 * 60 * 60 * 1000;

export async function createSession(
  userId: string,
): Promise<{ id: string; expiresAt: Date }> {
  const id = nanoid(48);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { id, userId, expiresAt },
  });
  return { id, expiresAt };
}

/**
 * Drop all existing sessions for a user and mint a fresh one. Called on
 * successful login to defeat session fixation: a previously-issued ID
 * (e.g. one that an attacker tricked the user into accepting before
 * login) becomes invalid the moment authentication succeeds.
 */
export async function rotateSessionForUser(
  userId: string,
): Promise<{ id: string; expiresAt: Date }> {
  await prisma.session.deleteMany({ where: { userId } });
  return createSession(userId);
}

// Throttle the lastUsed write so an authenticated request only updates the
// row at most once per this window, avoiding a SQLite write on every request.
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export async function getSession(
  id: string,
): Promise<{ id: string; userId: string } | null> {
  const session = await prisma.session.findUnique({ where: { id } });
  if (!session) return null;
  const now = new Date();
  if (session.expiresAt < now) {
    await prisma.session.delete({ where: { id } }).catch(() => {});
    return null;
  }
  // Only refresh lastUsed when it's stale, so a burst of requests doesn't
  // amplify into one DB write each. A missing lastUsed is treated as stale.
  const lastUsedMs = session.lastUsed?.getTime() ?? 0;
  if (now.getTime() - lastUsedMs >= LAST_USED_THROTTLE_MS) {
    await prisma.session.update({
      where: { id },
      data: { lastUsed: now },
    });
  }
  return { id: session.id, userId: session.userId };
}

export async function revokeSession(id: string): Promise<void> {
  await prisma.session.delete({ where: { id } }).catch(() => {});
}

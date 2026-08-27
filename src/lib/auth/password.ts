import argon2 from "argon2";

const HASH_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
} as const;

// Pre-generated argon2id hash matching HASH_OPTIONS, used for the
// constant-time dummy verify on unknown-username login attempts so the
// timing channel doesn't leak which usernames exist. The plaintext is
// irrelevant - this hash is never compared against anything real.
const DUMMY_HASH =
    "$argon2id$v=19$m=19456,t=2,p=1$joZT9Ll/7LGcWhRChAha0w$7lVflMt4lqCBhlV7YIuy1nuhBYW5lcxixtkosy0OV6s";

export async function hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, HASH_OPTIONS);
}

export async function verifyPassword(
    hash: string,
    plain: string,
): Promise<boolean> {
    try {
        return await argon2.verify(hash, plain);
    } catch {
        return false;
    }
}

/**
 * Run argon2.verify against a fixed dummy hash without caring about the
 * result. Burns roughly the same wall-clock time as a real verify so
 * `/api/auth/login` against an unknown username takes the same time as a
 * real-but-wrong-password attempt. Defeats username enumeration via the
 * argon2-timing side channel.
 */
export async function dummyVerifyPassword(plain: string): Promise<void> {
    try {
        await argon2.verify(DUMMY_HASH, plain);
    } catch {
        /* intentional - only burning cycles to mask timing */
    }
}

import argon2 from 'argon2';
import bcrypt from 'bcrypt';

const ARGON2_CONFIG = {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB
    timeCost: 3,
    parallelism: 4,
    hashLength: 32,
};

const pepper = () => process.env.PASSWORD_PEPPER || '';

export async function hashPassword(password) {
    return argon2.hash(password + pepper(), ARGON2_CONFIG);
}

// Argon2 hashes are self-describing; legacy bcrypt hashes ($2 prefix) verify
// via fallback and are rehashed on login (needsMigration). Delete the bcrypt
// branch + dependency once no $2 hashes remain in users.password_hash.
export async function verifyPassword(password, hash) {
    if (hash.startsWith('$2')) {
        const valid = await bcryptCompare(password, hash);
        return { valid, needsMigration: valid };
    }
    try {
        return { valid: await argon2.verify(hash, password + pepper()), needsMigration: false };
    } catch {
        return { valid: false, needsMigration: false };
    }
}

// Legacy bcrypt hashes may be peppered (post-hardening) or not (original).
async function bcryptCompare(password, hash) {
    if (await bcrypt.compare(password + pepper(), hash)) {
        return true;
    }
    return bcrypt.compare(password, hash);
}

// Format-agnostic check for secondary confirmations (password change,
// TOTP disable, trade auth).
export async function comparePassword(password, hash) {
    const { valid } = await verifyPassword(password, hash);
    return valid;
}

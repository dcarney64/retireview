import crypto from 'node:crypto';

// AES-256-GCM at-rest encryption for secrets stored in the DB (e.g. TOTP
// secrets). Encrypted values are hex-encoded [iv | authTag | ciphertext]
// prefixed with 'enc:' so plaintext legacy values pass through unchanged.

const PREFIX = 'enc:';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey() {
    const hex = process.env.APP_ENCRYPTION_KEY;
    if (!hex) {
        throw new Error('APP_ENCRYPTION_KEY is required');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new Error('APP_ENCRYPTION_KEY must be a 32-byte hex string');
    }
    return Buffer.from(hex, 'hex');
}

export function encryptSecret(value) {
    if (!value) {
        return value ?? null;
    }
    if (String(value).startsWith(PREFIX)) {
        return value;
    }

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
        cipher.update(String(value), 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return PREFIX + Buffer.concat([iv, authTag, encrypted]).toString('hex');
}

export function decryptSecret(value) {
    if (!value) {
        return value ?? null;
    }
    if (!String(value).startsWith(PREFIX)) {
        return value;
    }

    const key = getEncryptionKey();
    const payload = Buffer.from(String(value).slice(PREFIX.length), 'hex');
    const iv = payload.subarray(0, IV_LENGTH);
    const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]).toString('utf8');
}

import crypto from 'node:crypto';

import jwt from 'jsonwebtoken';

import { query } from '../db/client.js';

const ACCESS_DEFAULT_EXPIRY = '15m';
const REFRESH_DEFAULT_EXPIRY = '7d';
const TEMP_2FA_EXPIRY = '15m';

export function issueAccessToken(user) {
    return jwt.sign(
        { sub: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_ACCESS_EXPIRES || ACCESS_DEFAULT_EXPIRY }
    );
}

export function issueRefreshToken(user) {
    return jwt.sign(
        // jti makes every token unique: without it, two logins in the same
        // second mint identical JWTs (same sub + iat) and the second insert
        // violates the refresh_tokens.token_hash unique constraint.
        { sub: user.id, jti: crypto.randomUUID() },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRES || REFRESH_DEFAULT_EXPIRY }
    );
}

export function verifyAccessToken(token) {
    return jwt.verify(token, process.env.JWT_SECRET);
}

// Short-lived token issued between password check and OTP verification.
// Bound to the client IP; only valid on the 2FA endpoints.
export function issueTempToken(userId, ip) {
    return jwt.sign(
        { sub: userId, purpose: '2fa', ip },
        process.env.JWT_SECRET,
        { expiresIn: TEMP_2FA_EXPIRY }
    );
}

export function verifyTempToken(token, ip) {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.purpose !== '2fa' || payload.ip !== ip) {
        throw new Error('Invalid temp token');
    }
    return payload;
}

export function verifyRefreshToken(token) {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

export function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

export async function saveRefreshToken(userId, token) {
    const tokenHash = hashToken(token);
    const decoded = verifyRefreshToken(token);
    const expiresAt = new Date(decoded.exp * 1000);

    await query(
        `
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked)
        VALUES ($1, $2, $3, false)
        `,
        [userId, tokenHash, expiresAt]
    );

    return tokenHash;
}

export async function revokeRefreshToken(tokenHash) {
    await query(
        `
        UPDATE refresh_tokens
        SET revoked = true
        WHERE token_hash = $1
        `,
        [tokenHash]
    );
}

export async function getStoredRefreshToken(tokenHash) {
    const result = await query(
        `
        SELECT token_hash, revoked, expires_at
        FROM refresh_tokens
        WHERE token_hash = $1
        LIMIT 1
        `,
        [tokenHash]
    );

    return result.rows[0] || null;
}

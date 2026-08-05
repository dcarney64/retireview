import crypto from 'node:crypto';

import { query } from '../db/client.js';
import { sendOTPEmail } from './emailService.js';

const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const TRUST_DURATION_DAYS = 30;

function hashCode(code) {
    return crypto
        .createHash('sha256')
        .update(code + (process.env.OTP_PEPPER || ''))
        .digest('hex');
}

export async function generateAndSendOTP(userId, email, ipAddress) {
    // Expire (not "use") superseded codes so activity history stays accurate.
    await query(
        `UPDATE auth_otp SET expires_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()`,
        [userId]
    );

    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await query(
        `INSERT INTO auth_otp (user_id, code_hash, expires_at, ip_address)
         VALUES ($1, $2, $3, $4)`,
        [userId, hashCode(code), expiresAt, ipAddress]
    );

    await sendOTPEmail(email, code, ipAddress);

    return { expiresAt, maskedEmail: maskEmail(email) };
}

export async function verifyOTP(userId, code) {
    // Atomic: increment attempts on the newest live OTP only if under the cap.
    const result = await query(
        `UPDATE auth_otp SET attempts = attempts + 1
         WHERE id = (
             SELECT id FROM auth_otp
             WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
             ORDER BY created_at DESC
             LIMIT 1
         ) AND attempts < $2
         RETURNING id, code_hash`,
        [userId, MAX_ATTEMPTS]
    );

    if (!result.rows.length) {
        const live = await query(
            `SELECT id FROM auth_otp
             WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW()
             LIMIT 1`,
            [userId]
        );
        return {
            success: false,
            error: live.rows.length ? 'Too many attempts. Request a new code.' : 'No valid code found. Request a new code.',
            exhausted: live.rows.length > 0,
        };
    }

    const otp = result.rows[0];
    const expected = Buffer.from(otp.code_hash, 'hex');
    const actual = Buffer.from(hashCode(code), 'hex');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return { success: false, error: 'Invalid code' };
    }

    const used = await query(
        `UPDATE auth_otp SET used_at = NOW()
         WHERE id = $1 AND used_at IS NULL
         RETURNING id`,
        [otp.id]
    );
    if (!used.rows.length) {
        return { success: false, error: 'Code already used. Request a new code.' };
    }

    return { success: true };
}

export async function isIPTrusted(userId, ipAddress) {
    const result = await query(
        `SELECT id FROM user_trusted_ips
         WHERE user_id = $1 AND ip_address = $2
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [userId, ipAddress]
    );
    return result.rows.length > 0;
}

export async function trustIP(userId, ipAddress, label = null, permanent = false) {
    const expiresAt = permanent ? null : new Date(Date.now() + TRUST_DURATION_DAYS * 86400000);

    // Preserve permanence (NULL expiry) on re-trust from a normal login.
    await query(
        `INSERT INTO user_trusted_ips (user_id, ip_address, label, expires_at, last_seen)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, ip_address)
         DO UPDATE SET last_seen = NOW(),
           expires_at = CASE
             WHEN user_trusted_ips.expires_at IS NULL THEN NULL
             ELSE EXCLUDED.expires_at
           END`,
        [userId, ipAddress, label, expiresAt]
    );
}

export async function touchTrustedIP(userId, ipAddress) {
    await query(
        `UPDATE user_trusted_ips SET last_seen = NOW()
         WHERE user_id = $1 AND ip_address = $2`,
        [userId, ipAddress]
    );
}

export async function cleanupExpiredTrustedIPs() {
    const result = await query(`DELETE FROM user_trusted_ips WHERE expires_at < NOW()`);
    return result.rowCount;
}

export function maskEmail(email) {
    const [local, domain] = email.split('@');
    const masked = local[0] + '*'.repeat(Math.max(local.length - 2, 1)) + local[local.length - 1];
    return `${masked}@${domain}`;
}

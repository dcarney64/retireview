import crypto from 'node:crypto';

import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

import { decryptSecret, encryptSecret } from '../lib/secretCrypto.js';
import { query } from '../db/client.js';

const BACKUP_CODE_COUNT = 10;
const TOTP_WINDOW = 1;

function buildTOTP(secretBase32, label) {
    return new OTPAuth.TOTP({
        issuer: 'RetireView',
        label: label || 'RetireView',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(secretBase32),
    });
}

function generateBackupCodes() {
    const codes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
        crypto.randomBytes(4).toString('hex').toUpperCase());
    const hashed = codes.map((code) =>
        crypto.createHash('sha256').update(code).digest('hex'));
    return { codes, hashed };
}

export function isBackupCodeFormat(code) {
    return /^[0-9A-Fa-f]{8}$/.test(String(code).replace(/\s/g, ''));
}

export async function generateTOTPSetup(userId, userEmail) {
    const secret = new OTPAuth.Secret();
    const totp = buildTOTP(secret.base32, userEmail);

    const otpAuthUrl = totp.toString();
    const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);
    const { codes: backupCodes, hashed } = generateBackupCodes();

    // Pending setup: enabled_at stays NULL until the first code verifies.
    await query(
        `INSERT INTO user_totp (user_id, secret, backup_codes, enabled_at)
         VALUES ($1, $2, $3, NULL)
         ON CONFLICT (user_id) DO UPDATE SET
            secret = EXCLUDED.secret,
            backup_codes = EXCLUDED.backup_codes,
            enabled_at = NULL`,
        [userId, encryptSecret(secret.base32), hashed]
    );

    return { secret: secret.base32, qrCodeDataUrl, backupCodes, otpAuthUrl };
}

function validateCode(encryptedSecret, code) {
    const totp = buildTOTP(decryptSecret(encryptedSecret));
    return totp.validate({ token: String(code), window: TOTP_WINDOW }) !== null;
}

export async function verifyAndEnableTOTP(userId, code) {
    const result = await query(
        `SELECT secret, enabled_at FROM user_totp WHERE user_id = $1`,
        [userId]
    );
    if (!result.rows.length) {
        return { success: false, error: 'TOTP not set up' };
    }

    const { secret, enabled_at } = result.rows[0];
    if (!validateCode(secret, code)) {
        return { success: false, error: 'Invalid code' };
    }

    if (!enabled_at) {
        await query(
            `UPDATE user_totp SET enabled_at = NOW(), last_used_at = NOW() WHERE user_id = $1`,
            [userId]
        );
        await query(
            `UPDATE users SET totp_enabled = true, preferred_2fa = 'totp' WHERE id = $1`,
            [userId]
        );
    } else {
        await query(
            `UPDATE user_totp SET last_used_at = NOW() WHERE user_id = $1`,
            [userId]
        );
    }

    return { success: true };
}

// Login-time verification: only an ENABLED TOTP counts; a pending setup must
// never authenticate (or get enabled) from the login path.
export async function verifyTOTPLogin(userId, code) {
    if (isBackupCodeFormat(code)) {
        return verifyBackupCode(userId, code);
    }

    const result = await query(
        `SELECT secret FROM user_totp WHERE user_id = $1 AND enabled_at IS NOT NULL`,
        [userId]
    );
    if (!result.rows.length) {
        return { success: false, error: 'TOTP not enabled' };
    }
    if (!validateCode(result.rows[0].secret, code)) {
        return { success: false, error: 'Invalid code' };
    }

    await query(`UPDATE user_totp SET last_used_at = NOW() WHERE user_id = $1`, [userId]);
    return { success: true };
}

async function verifyBackupCode(userId, code) {
    const codeHash = crypto
        .createHash('sha256')
        .update(String(code).toUpperCase().replace(/\s/g, ''))
        .digest('hex');

    const result = await query(
        `SELECT backup_codes FROM user_totp WHERE user_id = $1 AND enabled_at IS NOT NULL`,
        [userId]
    );
    if (!result.rows.length) {
        return { success: false, error: 'TOTP not enabled' };
    }

    const codes = result.rows[0].backup_codes;
    const index = codes.indexOf(codeHash);
    if (index === -1) {
        return { success: false, error: 'Invalid code' };
    }

    const newCodes = codes.filter((_, i) => i !== index);
    // Guard against concurrent double-spend of the same code.
    const updated = await query(
        `UPDATE user_totp SET backup_codes = $1, last_used_at = NOW()
         WHERE user_id = $2 AND backup_codes = $3
         RETURNING user_id`,
        [newCodes, userId, codes]
    );
    if (!updated.rows.length) {
        return { success: false, error: 'Invalid code' };
    }

    return { success: true, usedBackupCode: true, remainingCodes: newCodes.length };
}

export async function regenerateBackupCodes(userId) {
    const { codes, hashed } = generateBackupCodes();
    const result = await query(
        `UPDATE user_totp SET backup_codes = $1
         WHERE user_id = $2 AND enabled_at IS NOT NULL
         RETURNING user_id`,
        [hashed, userId]
    );
    if (!result.rows.length) {
        return null;
    }
    return codes;
}

export async function getTOTPStatus(userId) {
    const result = await query(
        `SELECT enabled_at, last_used_at, array_length(backup_codes, 1) AS backup_count
         FROM user_totp
         WHERE user_id = $1 AND enabled_at IS NOT NULL`,
        [userId]
    );
    if (!result.rows.length) {
        return { enabled: false };
    }
    const row = result.rows[0];
    return {
        enabled: true,
        enabledAt: row.enabled_at,
        lastUsedAt: row.last_used_at,
        backupCodesRemaining: row.backup_count || 0,
    };
}

export async function disableTOTP(userId) {
    await query(`DELETE FROM user_totp WHERE user_id = $1`, [userId]);
    await query(
        `UPDATE users SET totp_enabled = false, preferred_2fa = 'email_otp' WHERE id = $1`,
        [userId]
    );
}

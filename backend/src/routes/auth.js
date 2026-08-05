import { Router } from 'express';

import { getClientIP, isLocalhost } from '../auth/clientIp.js';
import { requireAuth } from '../auth/middleware.js';
import { comparePassword, hashPassword, verifyPassword } from '../auth/password.js';
import { validateNewPassword } from '../auth/passwordPolicy.js';
import {
    getStoredRefreshToken,
    hashToken,
    issueAccessToken,
    issueRefreshToken,
    issueTempToken,
    revokeRefreshToken,
    saveRefreshToken,
    verifyRefreshToken,
    verifyTempToken,
} from '../auth/tokens.js';
import { query } from '../db/client.js';
import {
    loginLimiter,
    otpSendLimiter,
    otpVerifyLimiter,
    refreshLimiter,
    registerLimiter,
    verifyPasswordLimiter,
} from '../middleware/rateLimits.js';
import {
    clearFailedAttempts,
    isIPBlocked,
    isNewIPForUser,
    logLoginAttempt,
    recordFailedAttempt,
} from '../services/authSecurityService.js';
import { sendSecurityAlert } from '../services/emailService.js';
import { detectImpossibleTravel, lookupIP } from '../services/geoService.js';
import {
    generateAndSendOTP,
    isIPTrusted,
    touchTrustedIP,
    trustIP,
    verifyOTP,
} from '../services/otpService.js';
import {
    disableTOTP,
    generateTOTPSetup,
    getTOTPStatus,
    isBackupCodeFormat,
    regenerateBackupCodes,
    verifyAndEnableTOTP,
    verifyTOTPLogin,
} from '../services/totpService.js';

const router = Router();

async function completeLogin(user, res) {
    const accessToken = issueAccessToken(user);
    const refreshToken = issueRefreshToken(user);
    await saveRefreshToken(user.id, refreshToken);

    res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/api/auth',
        maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    await query(
        `UPDATE users SET last_login_at = now() WHERE id = $1`,
        [user.id]
    );

    return {
        accessToken,
        user: {
            id: user.id,
            email: user.email,
            role: user.role,
            fullName: user.full_name,
        },
    };
}

// Rejects the request and logs the attempt when the IP is blocked.
async function rejectIfBlocked(req, res, { email, userId } = {}) {
    const clientIP = getClientIP(req);
    const block = await isIPBlocked(clientIP);
    if (!block) {
        return false;
    }

    logLoginAttempt({
        userId,
        email,
        ipAddress: clientIP,
        userAgent: req.headers['user-agent'],
        success: false,
        failureReason: 'ip_blocked',
    }).catch((err) => console.error('[security] login log failed:', err.message));

    res.status(403).json({
        error: 'Access denied',
        reason: block.reason,
        until: block.expires_at,
    });
    return true;
}

// New-IP / impossible-travel checks must run BEFORE the success row is
// inserted, or the current IP always looks already-known.
async function finalizeAuthSuccess(req, user, { twoFaUsed = false, twoFaMethod = null } = {}) {
    const clientIP = getClientIP(req);
    try {
        const geo = lookupIP(clientIP);
        const isNew = await isNewIPForUser(user.id, clientIP);
        const travel = isNew ? await detectImpossibleTravel(user.id, geo.ll, new Date()) : false;

        await logLoginAttempt({
            userId: user.id,
            email: user.email,
            ipAddress: clientIP,
            userAgent: req.headers['user-agent'],
            success: true,
            twoFaUsed,
            twoFaMethod,
        });

        const alertEmail = user.two_fa_email || user.email;
        if (travel) {
            sendSecurityAlert(alertEmail, 'impossible_travel', {
                prevCity: travel.prevCity,
                newCity: geo.city,
                newCountry: geo.country,
                distance: travel.distance,
                timeDiffHours: travel.timeDiffHours,
            }).catch((err) => console.warn('[security] travel alert failed:', err.message));
        } else if (isNew) {
            sendSecurityAlert(alertEmail, 'new_ip', {
                ip: clientIP,
                city: geo.city,
                country: geo.country,
            }).catch((err) => console.warn('[security] new IP alert failed:', err.message));
        }
    } catch (err) {
        console.error('[security] auth success logging failed:', err.message);
    }
}

async function getTempTokenUser(req, res) {
    const { tempToken } = req.body || {};
    if (!tempToken) {
        res.status(400).json({ error: 'tempToken is required' });
        return null;
    }

    let payload;
    try {
        payload = verifyTempToken(tempToken, getClientIP(req));
    } catch (_error) {
        res.status(401).json({ error: 'Session expired. Please log in again.' });
        return null;
    }

    const result = await query(
        `SELECT id, email, role, full_name, two_fa_email, is_active,
                totp_enabled, preferred_2fa
         FROM users WHERE id = $1 LIMIT 1`,
        [payload.sub]
    );
    const user = result.rows[0];
    if (!user || !user.is_active) {
        res.status(401).json({ error: 'Session expired. Please log in again.' });
        return null;
    }
    return user;
}

async function failLogin(req, res, email, userId) {
    const clientIP = getClientIP(req);
    const blockResult = await recordFailedAttempt(clientIP, email, 'invalid_credentials');
    logLoginAttempt({
        userId,
        email,
        ipAddress: clientIP,
        userAgent: req.headers['user-agent'],
        success: false,
        failureReason: 'invalid_credentials',
    }).catch((err) => console.error('[security] login log failed:', err.message));

    if (blockResult.blocked) {
        return res.status(403).json({
            error: 'Too many failed attempts. Your IP has been temporarily blocked.',
            until: blockResult.expiresAt,
        });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
}

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        if (await rejectIfBlocked(req, res, { email })) {
            return undefined;
        }

        const userResult = await query(
            `
            SELECT id, email, role, full_name, password_hash, is_active,
                   two_fa_enabled, two_fa_email, totp_enabled, preferred_2fa
            FROM users
            WHERE email = $1
            LIMIT 1
            `,
            [email]
        );

        const user = userResult.rows[0];
        if (!user || !user.is_active) {
            return failLogin(req, res, email, null);
        }

        const { valid, needsMigration } = await verifyPassword(password, user.password_hash);
        if (!valid) {
            return failLogin(req, res, email, user.id);
        }

        if (needsMigration) {
            try {
                const newHash = await hashPassword(password);
                await query(
                    `UPDATE users SET password_hash = $1 WHERE id = $2`,
                    [newHash, user.id]
                );
                console.log(`[auth] Migrated password hash to argon2id for user ${user.id}`);
            } catch (err) {
                console.error('[auth] password hash migration failed:', err.message);
            }
        }

        const clientIP = getClientIP(req);
        await clearFailedAttempts(clientIP);
        const twoFAEnabled = process.env.TWO_FA_ENABLED !== 'false' && user.two_fa_enabled !== false;

        if (twoFAEnabled && isLocalhost(clientIP)) {
            console.log('[2FA] Localhost request — skipping 2FA');
        } else if (twoFAEnabled) {
            if (await isIPTrusted(user.id, clientIP)) {
                await touchTrustedIP(user.id, clientIP);
            } else {
                const useTotp = user.totp_enabled && user.preferred_2fa === 'totp';
                const challenge = {
                    requires2FA: true,
                    tempToken: issueTempToken(user.id, clientIP),
                    method: useTotp ? 'totp' : 'email_otp',
                    totpAvailable: Boolean(user.totp_enabled),
                };
                if (!useTotp) {
                    const otpEmail = user.two_fa_email || user.email;
                    const { maskedEmail, expiresAt } = await generateAndSendOTP(user.id, otpEmail, clientIP);
                    challenge.maskedEmail = maskedEmail;
                    challenge.expiresAt = expiresAt;
                }
                return res.json(challenge);
            }
        }

        await finalizeAuthSuccess(req, user);
        return res.json(await completeLogin(user, res));
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to login' });
    }
});

router.post('/2fa/send', otpSendLimiter, async (req, res) => {
    try {
        if (await rejectIfBlocked(req, res)) {
            return undefined;
        }

        const user = await getTempTokenUser(req, res);
        if (!user) {
            return undefined;
        }

        const clientIP = getClientIP(req);
        const otpEmail = user.two_fa_email || user.email;
        const { maskedEmail, expiresAt } = await generateAndSendOTP(user.id, otpEmail, clientIP);
        return res.json({ maskedEmail, expiresAt });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to send code' });
    }
});

router.post('/2fa/verify', otpVerifyLimiter, async (req, res) => {
    try {
        if (await rejectIfBlocked(req, res)) {
            return undefined;
        }

        const user = await getTempTokenUser(req, res);
        if (!user) {
            return undefined;
        }

        const { code, trustDevice } = req.body || {};
        const codeStr = String(code || '').trim();
        const isBackup = user.totp_enabled && isBackupCodeFormat(codeStr);
        if (!codeStr || (!/^\d{6}$/.test(codeStr) && !isBackup)) {
            return res.status(400).json({ error: 'A 6-digit code is required' });
        }

        const clientIP = getClientIP(req);

        // Method resolution: backup codes are 8 hex chars; with TOTP enabled a
        // 6-digit code tries the authenticator first, then any live email OTP.
        let result;
        let method;
        if (isBackup) {
            method = 'totp';
            result = await verifyTOTPLogin(user.id, codeStr);
        } else if (user.totp_enabled) {
            method = 'totp';
            result = await verifyTOTPLogin(user.id, codeStr);
            if (!result.success) {
                const emailResult = await verifyOTP(user.id, codeStr);
                if (emailResult.success) {
                    method = 'email_otp';
                    result = emailResult;
                }
            }
        } else {
            method = 'email_otp';
            result = await verifyOTP(user.id, codeStr);
        }

        if (!result.success) {
            logLoginAttempt({
                userId: user.id,
                email: user.email,
                ipAddress: clientIP,
                userAgent: req.headers['user-agent'],
                success: false,
                failureReason: '2fa_failed',
                twoFaUsed: true,
                twoFaMethod: method,
            }).catch((err) => console.error('[security] login log failed:', err.message));
            return res.status(400).json({ error: result.error, exhausted: result.exhausted || false });
        }

        if (trustDevice) {
            await trustIP(user.id, clientIP);
        }

        await finalizeAuthSuccess(req, user, { twoFaUsed: true, twoFaMethod: method });
        const payload = await completeLogin(user, res);
        if (result.usedBackupCode) {
            payload.usedBackupCode = true;
            payload.backupCodesRemaining = result.remainingCodes;
        }
        return res.json(payload);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to verify code' });
    }
});

router.post('/refresh', refreshLimiter, async (req, res) => {
    try {
        const refreshToken = req.cookies?.refresh_token;
        if (!refreshToken) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const payload = verifyRefreshToken(refreshToken);
        const tokenHash = hashToken(refreshToken);
        const stored = await getStoredRefreshToken(tokenHash);

        if (!stored || stored.revoked || new Date(stored.expires_at) <= new Date()) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userResult = await query(
            `
            SELECT id, email, role
            FROM users
            WHERE id = $1 AND is_active = true
            LIMIT 1
            `,
            [payload.sub]
        );

        const user = userResult.rows[0];
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const accessToken = issueAccessToken(user);
        return res.json({ accessToken });
    } catch (_error) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
});

router.post('/logout', async (req, res) => {
    try {
        const refreshToken = req.cookies?.refresh_token;
        if (refreshToken) {
            const tokenHash = hashToken(refreshToken);
            await revokeRefreshToken(tokenHash);
        }

        res.clearCookie('refresh_token', { path: '/api/auth' });
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to logout' });
    }
});

router.get('/me', requireAuth, (req, res) => {
    return res.json(req.user);
});

router.get('/trusted-ips', requireAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, ip_address, label, first_seen, last_seen, expires_at
             FROM user_trusted_ips
             WHERE user_id = $1
             ORDER BY last_seen DESC`,
            [req.user.id]
        );
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load trusted IPs' });
    }
});

router.put('/trusted-ips/:id', requireAuth, async (req, res) => {
    try {
        const { label } = req.body || {};
        const result = await query(
            `UPDATE user_trusted_ips SET label = $1
             WHERE id = $2 AND user_id = $3
             RETURNING id, ip_address, label, first_seen, last_seen, expires_at`,
            [label?.trim() || null, req.params.id, req.user.id]
        );
        if (!result.rows.length) {
            return res.status(404).json({ error: 'Trusted IP not found' });
        }
        return res.json(result.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to update trusted IP' });
    }
});

router.delete('/trusted-ips/:id', requireAuth, async (req, res) => {
    try {
        const result = await query(
            `DELETE FROM user_trusted_ips WHERE id = $1 AND user_id = $2 RETURNING id`,
            [req.params.id, req.user.id]
        );
        if (!result.rows.length) {
            return res.status(404).json({ error: 'Trusted IP not found' });
        }
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to remove trusted IP' });
    }
});

// Remove all trusted devices and revoke every session; 2FA required on next
// login from every device (access tokens expire within 15 minutes).
router.delete('/trusted-ips', requireAuth, async (req, res) => {
    try {
        await query(`DELETE FROM user_trusted_ips WHERE user_id = $1`, [req.user.id]);
        await query(`UPDATE refresh_tokens SET revoked = true WHERE user_id = $1`, [req.user.id]);
        res.clearCookie('refresh_token', { path: '/api/auth' });
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to remove trusted devices' });
    }
});

router.get('/otp-activity', requireAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, created_at, ip_address, used_at, attempts, expires_at
             FROM auth_otp
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 10`,
            [req.user.id]
        );
        return res.json(result.rows.map((row) => ({
            id: row.id,
            date: row.created_at,
            ip: row.ip_address,
            status: row.used_at
                ? 'used'
                : row.attempts >= 5
                    ? 'failed'
                    : new Date(row.expires_at) <= new Date()
                        ? 'expired'
                        : 'pending',
        })));
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load OTP activity' });
    }
});

router.post('/verify-password', requireAuth, verifyPasswordLimiter, async (req, res) => {
    try {
        const { password } = req.body || {};
        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }
        const result = await query(
            `SELECT password_hash FROM users WHERE id = $1 LIMIT 1`,
            [req.user.id]
        );
        const valid = result.rows.length &&
            await comparePassword(password, result.rows[0].password_hash);
        return res.json({ valid: Boolean(valid) });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to verify password' });
    }
});

router.get('/totp/status', requireAuth, async (req, res) => {
    try {
        return res.json(await getTOTPStatus(req.user.id));
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load TOTP status' });
    }
});

router.post('/totp/setup', requireAuth, async (req, res) => {
    try {
        const setup = await generateTOTPSetup(req.user.id, req.user.email);
        return res.json(setup);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to set up TOTP' });
    }
});

router.post('/totp/verify-setup', requireAuth, async (req, res) => {
    try {
        const { code } = req.body || {};
        if (!code || !/^\d{6}$/.test(String(code).trim())) {
            return res.status(400).json({ error: 'A 6-digit code is required' });
        }

        const result = await verifyAndEnableTOTP(req.user.id, String(code).trim());
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        return res.json({ success: true, message: 'TOTP enabled successfully' });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to verify TOTP' });
    }
});

router.post('/totp/disable', requireAuth, async (req, res) => {
    try {
        const { password } = req.body || {};
        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }

        const result = await query(
            `SELECT password_hash FROM users WHERE id = $1 LIMIT 1`,
            [req.user.id]
        );
        const isValid = result.rows.length &&
            await comparePassword(password, result.rows[0].password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Incorrect password' });
        }

        await disableTOTP(req.user.id);
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to disable TOTP' });
    }
});

router.post('/totp/backup-codes/regenerate', requireAuth, async (req, res) => {
    try {
        const codes = await regenerateBackupCodes(req.user.id);
        if (!codes) {
            return res.status(400).json({ error: 'TOTP is not enabled' });
        }
        return res.json({ backupCodes: codes });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to regenerate backup codes' });
    }
});

router.post('/register', registerLimiter, async (req, res) => {
    try {
        const { fullName, email, password } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        if (await rejectIfBlocked(req, res, { email })) {
            return undefined;
        }

        const policy = await validateNewPassword(password, [
            email,
            email.split('@')[0],
            fullName,
            ...(fullName ? String(fullName).split(' ') : []),
        ]);
        if (!policy.valid) {
            return res.status(400).json({
                error: policy.feedback,
                score: policy.score,
                suggestions: policy.suggestions,
            });
        }

        const existing = await query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'An account with that email already exists' });
        }

        const passwordHash = await hashPassword(password);
        const created = await query(
            `INSERT INTO users (full_name, email, password_hash, role, is_active)
             VALUES ($1, $2, $3, 'user', true)
             RETURNING id, email, role, full_name`,
            [fullName?.trim() || null, email.trim().toLowerCase(), passwordHash]
        );
        const user = created.rows[0];

        const accessToken = issueAccessToken(user);
        const refreshToken = issueRefreshToken(user);
        await saveRefreshToken(user.id, refreshToken);

        res.cookie('refresh_token', refreshToken, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/api/auth',
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });

        logLoginAttempt({
            userId: user.id,
            email: user.email,
            ipAddress: getClientIP(req),
            userAgent: req.headers['user-agent'],
            success: true,
            failureReason: 'registration',
        }).catch((err) => console.error('[security] login log failed:', err.message));

        return res.status(201).json({
            accessToken,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                fullName: user.full_name,
            },
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to create account' });
    }
});

export default router;

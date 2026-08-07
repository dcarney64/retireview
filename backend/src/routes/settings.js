import { Router } from 'express';

import { requireAuth } from '../auth/middleware.js';
import { comparePassword, hashPassword } from '../auth/password.js';
import { validateNewPassword } from '../auth/passwordPolicy.js';
import { query } from '../db/client.js';
import { sendWeeklyDigest } from '../services/digestService.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, email, full_name, role, two_fa_enabled, two_fa_email,
                    totp_enabled, preferred_2fa, email_digest_enabled,
                    digest_frequency, created_at
             FROM users
             WHERE id = $1
             LIMIT 1`,
            [req.user.id]
        );

        if (!result.rowCount) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json(result.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to load settings' });
    }
});

router.patch('/profile', requireAuth, async (req, res) => {
    try {
        const { fullName } = req.body || {};

        const updated = await query(
            `UPDATE users
             SET full_name = $2, updated_at = now()
             WHERE id = $1
             RETURNING id, email, full_name, role`,
            [req.user.id, fullName?.trim() || null]
        );

        return res.json(updated.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to update profile' });
    }
});

router.patch('/notifications', requireAuth, async (req, res) => {
    try {
        const { email_digest_enabled, digest_frequency } = req.body || {};

        if (email_digest_enabled !== undefined && typeof email_digest_enabled !== 'boolean') {
            return res.status(400).json({ error: 'email_digest_enabled must be a boolean' });
        }
        const VALID_FREQUENCIES = ['weekly', 'monthly'];
        if (digest_frequency !== undefined && !VALID_FREQUENCIES.includes(digest_frequency)) {
            return res.status(400).json({ error: `digest_frequency must be one of: ${VALID_FREQUENCIES.join(', ')}` });
        }

        const updated = await query(
            `UPDATE users
             SET email_digest_enabled = COALESCE($2, email_digest_enabled),
                 digest_frequency = COALESCE($3, digest_frequency),
                 updated_at = now()
             WHERE id = $1
             RETURNING email_digest_enabled, digest_frequency`,
            [req.user.id, email_digest_enabled ?? null, digest_frequency ?? null]
        );

        return res.json(updated.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to update notifications' });
    }
});

// Sends the digest immediately so the user can preview it
router.post('/notifications/test', requireAuth, async (req, res) => {
    try {
        const result = await sendWeeklyDigest(req.user.id);
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to send test digest' });
    }
});

router.patch('/password', requireAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'currentPassword and newPassword are required' });
        }

        const userResult = await query(
            `SELECT password_hash FROM users WHERE id = $1 LIMIT 1`,
            [req.user.id]
        );

        const user = userResult.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const isValid = await comparePassword(currentPassword, user.password_hash);
        if (!isValid) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }

        const policy = await validateNewPassword(newPassword, [req.user.email]);
        if (!policy.valid) {
            return res.status(400).json({
                error: policy.feedback,
                score: policy.score,
                suggestions: policy.suggestions,
            });
        }

        const passwordHash = await hashPassword(newPassword);
        await query(
            `UPDATE users
             SET password_hash = $2, updated_at = now()
             WHERE id = $1`,
            [req.user.id, passwordHash]
        );

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to update password' });
    }
});

export default router;

import { Router } from 'express';

import { requireAdmin, requireAuth } from '../auth/middleware.js';
import { hashPassword } from '../auth/password.js';
import { query } from '../db/client.js';
import { blockIP, unblockIP } from '../services/authSecurityService.js';
import { lookupIP } from '../services/geoService.js';

const router = Router();

// ============================================================
// USER MANAGEMENT
// ============================================================

router.get('/users', requireAdmin, async (_req, res) => {
    try {
        const result = await query(
            `SELECT id, full_name, email, role, is_active, last_login_at, created_at
             FROM users
             ORDER BY created_at DESC`
        );
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to fetch users' });
    }
});

router.post('/users', requireAdmin, async (req, res) => {
    try {
        const { fullName, email, password, role = 'user' } = req.body || {};

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const existing = await query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
        if (existing.rowCount) {
            return res.status(409).json({ error: 'Email already exists' });
        }

        const passwordHash = await hashPassword(password);
        const created = await query(
            `INSERT INTO users (full_name, email, password_hash, role, is_active)
             VALUES ($1, $2, $3, $4, true)
             RETURNING id, full_name, email, role, is_active, created_at`,
            [fullName || null, email, passwordHash, role]
        );

        return res.status(201).json(created.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to create user' });
    }
});

router.patch('/users/:id', requireAdmin, async (req, res) => {
    try {
        const { is_active, role, full_name } = req.body || {};

        const updated = await query(
            `UPDATE users
             SET
                 is_active = COALESCE($2, is_active),
                 role = COALESCE($3, role),
                 full_name = COALESCE($4, full_name),
                 updated_at = now()
             WHERE id = $1
             RETURNING id, full_name, email, role, is_active, updated_at`,
            [req.params.id, is_active, role, full_name]
        );

        if (!updated.rowCount) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json(updated.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to update user' });
    }
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
    try {
        if (req.params.id === req.user.id) {
            return res.status(400).json({ error: 'You cannot delete your own account' });
        }

        const deleted = await query(
            `DELETE FROM users WHERE id = $1 RETURNING id`,
            [req.params.id]
        );

        if (!deleted.rowCount) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to delete user' });
    }
});

// ============================================================
// SYSTEM STATUS
// ============================================================

router.get('/status', requireAuth, async (_req, res) => {
    try {
        let dbConnected = false;
        try {
            await query('SELECT 1');
            dbConnected = true;
        } catch (_e) { /* */ }

        return res.json({
            system: {
                dbConnected,
                backendUptime: process.uptime(),
                nodeVersion: process.version,
                environment: process.env.NODE_ENV || 'development',
            },
        });
    } catch (error) {
        return res.status(500).json({ error: error.message || 'Failed to fetch status' });
    }
});

// ============================================================
// SECURITY — BLOCKED IPS, LOGIN HISTORY, SESSIONS
// ============================================================

router.get('/security/blocked-ips', requireAdmin, async (_req, res) => {
    try {
        const result = await query(
            `SELECT id, ip_address, reason, blocked_at, blocked_by,
                    expires_at, attempt_count, is_permanent
             FROM blocked_ips
             ORDER BY blocked_at DESC`
        );
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

router.post('/security/block-ip', requireAdmin, async (req, res) => {
    try {
        const { ip, reason, durationMinutes, permanent } = req.body || {};
        if (!ip || !reason) {
            return res.status(400).json({ error: 'ip and reason are required' });
        }
        await blockIP(ip.trim(), reason.trim(), req.user.id, {
            permanent: Boolean(permanent),
            durationMinutes: Number(durationMinutes) || 43200,
        });
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

router.delete('/security/blocked-ips/:ip', requireAdmin, async (req, res) => {
    try {
        await unblockIP(req.params.ip);
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

router.get('/security/login-history', requireAdmin, async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const page = Math.max(Number(req.query.page) || 0, 0);
        const filters = [];
        const params = [];

        if (req.query.userId) {
            params.push(req.query.userId);
            filters.push(`h.user_id = $${params.length}`);
        }
        if (req.query.success === 'true' || req.query.success === 'false') {
            params.push(req.query.success === 'true');
            filters.push(`h.success = $${params.length}`);
        }

        const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
        params.push(limit, page * limit);

        const result = await query(
            `SELECT h.id, h.user_id, h.email, h.ip_address, h.user_agent,
                    h.country, h.city, h.success, h.failure_reason,
                    h.two_fa_used, h.two_fa_method, h.created_at,
                    (h.success AND h.user_id IS NOT NULL
                     AND h.country IS DISTINCT FROM 'Local'
                     AND NOT EXISTS (
                        SELECT 1 FROM user_login_history prev
                        WHERE prev.user_id = h.user_id
                          AND prev.ip_address = h.ip_address
                          AND prev.success = true
                          AND prev.created_at < h.created_at
                    )) AS is_new_ip
             FROM user_login_history h
             ${where}
             ORDER BY h.created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

router.get('/security/failed-attempts', requireAdmin, async (_req, res) => {
    try {
        const result = await query(
            `SELECT ip_address, COUNT(*)::int AS attempts,
                    MAX(attempted_at) AS last_attempt
             FROM ip_failed_attempts
             WHERE attempted_at > NOW() - INTERVAL '24 hours'
             GROUP BY ip_address
             ORDER BY attempts DESC
             LIMIT 20`
        );
        return res.json(result.rows.map((row) => {
            const geo = lookupIP(row.ip_address);
            return {
                ...row,
                location: [geo.city, geo.country].filter(Boolean).join(', ') || null,
            };
        }));
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

router.get('/security/sessions', requireAdmin, async (_req, res) => {
    try {
        const result = await query(
            `SELECT u.id AS user_id, u.email, u.full_name,
                    COUNT(rt.token_hash)::int AS active_sessions,
                    MAX(rt.expires_at) AS latest_expiry
             FROM users u
             LEFT JOIN refresh_tokens rt
               ON rt.user_id = u.id AND rt.revoked = false AND rt.expires_at > NOW()
             WHERE u.is_active = true
             GROUP BY u.id, u.email, u.full_name
             ORDER BY active_sessions DESC, u.email`
        );
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

router.post('/security/revoke-sessions/:userId', requireAdmin, async (req, res) => {
    try {
        const result = await query(
            `UPDATE refresh_tokens SET revoked = true
             WHERE user_id = $1 AND revoked = false`,
            [req.params.userId]
        );
        return res.json({ success: true, revoked: result.rowCount });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;

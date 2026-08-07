import { query } from '../db/client.js';

/**
 * requireProfile — must run after requireAuth.
 *
 * Reads the X-Profile-Id request header and resolves it to a
 * validated profile that belongs to the authenticated user.
 *
 * Header values:
 *   (missing) | 'combined' → req.profileId = null  (aggregate all profiles)
 *   'primary'              → req.profileId = user's primary profile id
 *   '<integer>'            → req.profileId = that profile id (validated)
 *
 * Always sets:
 *   req.primaryProfileId   → integer id of the user's primary profile
 *
 * On error (profile not found or doesn't belong to user) → 403.
 */
export async function requireProfile(req, res, next) {
    try {
        // Look up the primary profile for this user (always needed).
        const primaryResult = await query(
            `SELECT id FROM profiles WHERE user_id = $1 AND is_primary = true LIMIT 1`,
            [req.user.id]
        );

        if (!primaryResult.rowCount) {
            // Seed a primary profile on the fly if somehow missing.
            const userResult = await query(
                `SELECT email, full_name FROM users WHERE id = $1`,
                [req.user.id]
            );
            const u = userResult.rows[0];
            const name = u?.full_name?.split(' ')[0] || u?.email?.split('@')[0] || 'Me';
            const seedResult = await query(
                `INSERT INTO profiles (user_id, name, relationship, is_primary, color, avatar_initial)
                 VALUES ($1, $2, 'self', true, '#6366f1', $3)
                 ON CONFLICT DO NOTHING
                 RETURNING id`,
                [req.user.id, name, name[0]?.toUpperCase() || 'M']
            );
            req.primaryProfileId = seedResult.rows[0]?.id || null;
        } else {
            req.primaryProfileId = primaryResult.rows[0].id;
        }

        const header = req.headers['x-profile-id'];

        // No header or explicit 'combined' → combined mode
        if (!header || header === 'combined') {
            req.profileId = null;
            return next();
        }

        // 'primary' → use the primary profile
        if (header === 'primary') {
            req.profileId = req.primaryProfileId;
            return next();
        }

        // Numeric profile id — validate ownership
        const parsedId = parseInt(header, 10);
        if (!Number.isFinite(parsedId) || parsedId <= 0) {
            return res.status(400).json({ error: 'Invalid X-Profile-Id header' });
        }

        const profileResult = await query(
            `SELECT id FROM profiles WHERE id = $1 AND user_id = $2`,
            [parsedId, req.user.id]
        );
        if (!profileResult.rowCount) {
            return res.status(403).json({ error: 'Profile not found or access denied' });
        }

        req.profileId = parsedId;
        return next();
    } catch (err) {
        return res.status(500).json({ error: err.message || 'Profile resolution failed' });
    }
}

/**
 * Resolve effective write profileId for POST/PUT routes.
 * In combined mode (profileId = null) falls back to the primary profile.
 */
export function writeProfileId(req) {
    return req.profileId ?? req.primaryProfileId;
}

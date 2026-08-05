import { query } from '../db/client.js';
import { lookupIP } from './geoService.js';

const BLOCK_THRESHOLD = Number(process.env.MAX_LOGIN_ATTEMPTS) || 5;
const BLOCK_DURATIONS = [5, Number(process.env.AUTO_BLOCK_DURATION_MINUTES) || 60, 1440];
const HISTORY_RETENTION_DAYS = Number(process.env.LOGIN_HISTORY_RETENTION_DAYS) || 90;

function isExemptIP(ip) {
    return !ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1' ||
        ip.startsWith('192.168.') || ip.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

export async function logLoginAttempt({
    userId, email, ipAddress, userAgent,
    success, failureReason, twoFaUsed, twoFaMethod,
}) {
    const geo = lookupIP(ipAddress);

    await query(
        `INSERT INTO user_login_history (
            user_id, email, ip_address, user_agent,
            country, city, region, ll_json,
            success, failure_reason, two_fa_used, two_fa_method
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
            userId || null, email || null, ipAddress, userAgent || null,
            geo.country, geo.city, geo.region,
            geo.ll ? JSON.stringify(geo.ll) : null,
            success, failureReason || null,
            twoFaUsed || false, twoFaMethod || null,
        ]
    );

    return geo;
}

export async function isIPBlocked(ipAddress) {
    if (isExemptIP(ipAddress)) return null;

    const result = await query(
        `SELECT id, reason, expires_at, is_permanent
         FROM blocked_ips
         WHERE ip_address = $1
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [ipAddress]
    );
    return result.rows[0] || null;
}

export async function recordFailedAttempt(ipAddress, email, reason) {
    await query(
        `INSERT INTO ip_failed_attempts (ip_address, email_attempted, failure_reason)
         VALUES ($1, $2, $3)`,
        [ipAddress, email || null, reason]
    );

    if (isExemptIP(ipAddress)) return { blocked: false };

    const countResult = await query(
        `SELECT COUNT(*)::int AS cnt FROM ip_failed_attempts
         WHERE ip_address = $1
           AND attempted_at > NOW() - INTERVAL '1 hour'`,
        [ipAddress]
    );
    const failCount = countResult.rows[0].cnt;

    if (failCount < BLOCK_THRESHOLD) {
        return { blocked: false, failCount };
    }

    // attempt_count = times this IP has been blocked; drives escalation tier.
    const existing = await query(
        `SELECT attempt_count FROM blocked_ips WHERE ip_address = $1`,
        [ipAddress]
    );
    const timesBlocked = existing.rows[0]?.attempt_count || 0;
    const durationMinutes = BLOCK_DURATIONS[Math.min(timesBlocked, BLOCK_DURATIONS.length - 1)];
    const expiresAt = new Date(Date.now() + durationMinutes * 60000);

    await query(
        `INSERT INTO blocked_ips (ip_address, reason, expires_at, attempt_count)
         VALUES ($1, $2, $3, 1)
         ON CONFLICT (ip_address) DO UPDATE SET
            reason = EXCLUDED.reason,
            expires_at = EXCLUDED.expires_at,
            attempt_count = blocked_ips.attempt_count + 1,
            blocked_at = NOW()`,
        [ipAddress, `Auto-blocked: ${failCount} failed attempts in 1 hour`, expiresAt]
    );

    // Blocked IPs stop hitting the failure counter; clear so the next window
    // starts fresh after the block lapses.
    await query(`DELETE FROM ip_failed_attempts WHERE ip_address = $1`, [ipAddress]);

    return { blocked: true, durationMinutes, expiresAt };
}

export async function clearFailedAttempts(ipAddress) {
    await query(`DELETE FROM ip_failed_attempts WHERE ip_address = $1`, [ipAddress]);
}

export async function blockIP(ipAddress, reason, adminUserId, { permanent = false, durationMinutes = 43200 } = {}) {
    const expiresAt = permanent ? null : new Date(Date.now() + durationMinutes * 60000);

    await query(
        `INSERT INTO blocked_ips (ip_address, reason, blocked_by, expires_at, is_permanent)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (ip_address) DO UPDATE SET
            reason = EXCLUDED.reason,
            blocked_by = EXCLUDED.blocked_by,
            expires_at = EXCLUDED.expires_at,
            is_permanent = EXCLUDED.is_permanent,
            blocked_at = NOW()`,
        [ipAddress, reason, adminUserId, expiresAt, permanent]
    );
}

export async function unblockIP(ipAddress) {
    await query(`DELETE FROM blocked_ips WHERE ip_address = $1`, [ipAddress]);
    await query(`DELETE FROM ip_failed_attempts WHERE ip_address = $1`, [ipAddress]);
}

export async function getLoginHistory(userId, limit = 20) {
    const result = await query(
        `SELECT id, ip_address, user_agent, country, city,
                success, failure_reason, two_fa_used, two_fa_method, created_at
         FROM user_login_history
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
    );
    return result.rows;
}

// True when this user has never successfully logged in from this IP before.
export async function isNewIPForUser(userId, ipAddress) {
    if (isExemptIP(ipAddress)) return false;
    const result = await query(
        `SELECT id FROM user_login_history
         WHERE user_id = $1 AND ip_address = $2 AND success = true
         LIMIT 1`,
        [userId, ipAddress]
    );
    return result.rows.length === 0;
}

export async function cleanupSecurityTables() {
    const attempts = await query(
        `DELETE FROM ip_failed_attempts
         WHERE attempted_at < NOW() - INTERVAL '24 hours'`
    );
    const blocks = await query(
        `DELETE FROM blocked_ips
         WHERE expires_at < NOW() AND is_permanent = false`
    );
    const history = await query(
        `DELETE FROM user_login_history
         WHERE created_at < NOW() - ($1 || ' days')::interval`,
        [HISTORY_RETENTION_DAYS]
    );

    return {
        attemptsCleared: attempts.rowCount,
        blocksExpired: blocks.rowCount,
        historyTrimmed: history.rowCount,
    };
}

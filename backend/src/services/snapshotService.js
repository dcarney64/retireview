import pool from '../db/client.js';

// Captures the user's current account balances as a point-in-time record.
// One snapshot per day: snapping again the same day replaces it.
// Used by POST /api/snapshots and the nightly SnapTrade sync job.
export async function takeSnapshot(userId, note = null) {
    const client = await pool.connect();
    try {
        const accounts = await client.query(
            `SELECT id, balance FROM accounts WHERE user_id = $1 AND include_in_tracking = true`,
            [userId]
        );

        if (!accounts.rowCount) {
            return { skipped: true, reason: 'no accounts' };
        }

        const total = accounts.rows.reduce((sum, row) => sum + Number(row.balance), 0);

        await client.query('BEGIN');

        const snapshot = await client.query(
            `INSERT INTO snapshots (user_id, total, note, snapped_at)
             VALUES ($1, $2, $3, CURRENT_DATE)
             ON CONFLICT (user_id, snapped_at)
             DO UPDATE SET total = EXCLUDED.total, note = EXCLUDED.note, created_at = now()
             RETURNING id, total, note, snapped_at, created_at`,
            [userId, total, note?.trim() || null]
        );
        const snapshotId = snapshot.rows[0].id;

        // Replace any per-account rows from an earlier snapshot today
        await client.query(
            `DELETE FROM account_snapshots WHERE snapshot_id = $1`,
            [snapshotId]
        );
        for (const account of accounts.rows) {
            await client.query(
                `INSERT INTO account_snapshots (snapshot_id, account_id, balance)
                 VALUES ($1, $2, $3)`,
                [snapshotId, account.id, account.balance]
            );
        }

        await client.query('COMMIT');
        return { skipped: false, snapshot: snapshot.rows[0] };
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

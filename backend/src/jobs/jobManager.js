import cron from 'node-cron';

import { query } from '../db/client.js';
import { cleanupSecurityTables } from '../services/authSecurityService.js';
import { syncComposerAccountsForUser } from '../services/composerService.js';
import { sendWeeklyDigest } from '../services/digestService.js';
import { cleanupExpiredTrustedIPs } from '../services/otpService.js';
import { isConfigured as snaptradeConfigured, syncAccountsForUser } from '../services/snaptradeService.js';

// Nightly at 4:00 AM — prunes expired trusted IPs, stale OTPs, expired IP
// blocks, and old login history (LOGIN_HISTORY_RETENTION_DAYS).
const AUTH_CLEANUP_CRON = '0 4 * * *';

let authCleanupJob = null;

export async function runAuthCleanupJob() {
    try {
        const removed = await cleanupExpiredTrustedIPs();
        console.log(`[2FA] Removed ${removed} expired trusted IP(s)`);
    } catch (error) {
        console.error('[2FA] Trusted IP cleanup failed:', error.message);
    }

    try {
        const result = await query(
            `DELETE FROM auth_otp WHERE created_at < NOW() - INTERVAL '24 hours'`
        );
        if (result.rowCount > 0) {
            console.log(`[2FA] Removed ${result.rowCount} old OTP row(s)`);
        }
    } catch (error) {
        console.error('[2FA] OTP cleanup failed:', error.message);
    }

    try {
        const securityCleanup = await cleanupSecurityTables();
        console.log('[security cleanup]', securityCleanup);
    } catch (error) {
        console.error('[security cleanup] failed:', error.message);
    }
}

export async function initAllJobs() {
    if (authCleanupJob) authCleanupJob.stop();
    authCleanupJob = cron.schedule(AUTH_CLEANUP_CRON, runAuthCleanupJob);
    console.log('Scheduled jobs initialized');

    // ADD YOUR APP JOBS BELOW THIS LINE, e.g.:
    // cron.schedule('0 2 * * *', runNightlySync);

    if (snaptradeJob) snaptradeJob.stop();
    snaptradeJob = cron.schedule(SNAPTRADE_SYNC_CRON, runSnapTradeSyncJob);

    if (composerSyncJob) composerSyncJob.stop();
    composerSyncJob = cron.schedule(COMPOSER_SYNC_CRON, runComposerSyncJob);

    if (weeklyDigestJob) weeklyDigestJob.stop();
    weeklyDigestJob = cron.schedule(WEEKLY_DIGEST_CRON, runWeeklyDigestJob);
}

// Monday 8:00 AM — emails a net-worth summary to every active user who has
// digests enabled. Runs after the 5:30/5:45 syncs so balances are fresh.
const WEEKLY_DIGEST_CRON = process.env.WEEKLY_DIGEST_CRON || '0 8 * * 1';

let weeklyDigestJob = null;

export async function runWeeklyDigestJob() {
    try {
        const users = await query(
            `SELECT id, email FROM users
             WHERE is_active = true AND email_digest_enabled = true`
        );

        for (const row of users.rows) {
            try {
                await sendWeeklyDigest(row.id);
                console.log(`[digest] Sent weekly digest to ${row.email}`);
            } catch (error) {
                console.error(`[digest] Failed for ${row.email}:`, error.message);
            }
        }
    } catch (error) {
        console.error('[digest] Weekly digest job failed:', error.message);
    }
}

// Daily at 5:30 AM (SNAPTRADE_SYNC_CRON) — refreshes balances from SnapTrade
// for every user who already has linked accounts (the first sync is always
// triggered manually from the Accounts page), then auto-snapshots so the
// net-worth history stays continuous. Skips quietly when not configured.
const SNAPTRADE_SYNC_CRON = process.env.SNAPTRADE_SYNC_CRON || '30 5 * * *';

let snaptradeJob = null;

// Daily at 5:45 AM — pulls Composer portfolio balances for every user who has
// stored Composer API credentials. Auto-snapshots after each successful sync.
const COMPOSER_SYNC_CRON = process.env.COMPOSER_SYNC_CRON || '45 5 * * *';

let composerSyncJob = null;

export async function runComposerSyncJob() {
    try {
        const users = await query('SELECT user_id FROM composer_credentials');

        for (const row of users.rows) {
            try {
                // takeSnapshot is called automatically inside syncComposerAccountsForUser.
                const summary = await syncComposerAccountsForUser(row.user_id);
                console.log(
                    `[composer] Synced user ${row.user_id}: ${summary.accountsUpdated} account(s) updated`
                );
            } catch (error) {
                console.error(`[composer] Sync failed for user ${row.user_id}:`, error.message);
            }
        }
    } catch (error) {
        console.error('[composer] Sync job failed:', error.message);
    }
}

export async function runSnapTradeSyncJob() {
    if (!snaptradeConfigured()) {
        return;
    }

    try {
        const users = await query(
            `SELECT DISTINCT user_id FROM accounts WHERE source = 'snaptrade'`
        );

        for (const row of users.rows) {
            try {
                // takeSnapshot is called automatically inside syncAccountsForUser.
                const summary = await syncAccountsForUser(row.user_id);
                console.log(
                    `[snaptrade] Synced user ${row.user_id}: ${summary.updated} updated, `
                    + `${summary.created} created, ${summary.failures.length} failed`
                );
            } catch (error) {
                console.error(`[snaptrade] Sync failed for user ${row.user_id}:`, error.message);
            }
        }
    } catch (error) {
        console.error('[snaptrade] Sync job failed:', error.message);
    }
}

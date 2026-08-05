import cron from 'node-cron';

import { query } from '../db/client.js';
import { cleanupSecurityTables } from '../services/authSecurityService.js';
import { cleanupExpiredTrustedIPs } from '../services/otpService.js';

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
}

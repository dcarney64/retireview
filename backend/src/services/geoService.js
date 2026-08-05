import geoip from 'geoip-lite';

import { query } from '../db/client.js';

const TRAVEL_DISTANCE_KM = Number(process.env.IMPOSSIBLE_TRAVEL_DISTANCE_KM) || 500;
const TRAVEL_HOURS = Number(process.env.IMPOSSIBLE_TRAVEL_HOURS) || 2;

function isPrivateIP(ip) {
    if (!ip) return true;
    return (
        ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === 'unknown' ||
        ip.startsWith('192.168.') ||
        ip.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    );
}

export function lookupIP(ipAddress) {
    if (isPrivateIP(ipAddress)) {
        return { country: 'Local', city: 'localhost', region: null, timezone: null, ll: null };
    }

    const geo = geoip.lookup(ipAddress);
    if (!geo) {
        return { country: null, city: null, region: null, timezone: null, ll: null };
    }

    return {
        country: geo.country || null,
        city: geo.city || null,
        region: geo.region || null,
        timezone: geo.timezone || null,
        ll: geo.ll || null,
    };
}

export function distanceKm(ll1, ll2) {
    if (!ll1 || !ll2) return null;
    const R = 6371;
    const dLat = (ll2[0] - ll1[0]) * Math.PI / 180;
    const dLon = (ll2[1] - ll1[1]) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(ll1[0] * Math.PI / 180) *
        Math.cos(ll2[0] * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Same user, two successful logins too far apart to travel between in the
// elapsed time. Returns false or { distance, timeDiffHours, prevCity }.
export async function detectImpossibleTravel(userId, newLL, newTime) {
    if (!newLL) return false;

    const result = await query(
        `SELECT country, city, created_at, ll_json
         FROM user_login_history
         WHERE user_id = $1
           AND success = true
           AND created_at > NOW() - INTERVAL '24 hours'
           AND ll_json IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
    );

    if (!result.rows.length) return false;

    const prev = result.rows[0];
    let prevLL;
    try {
        prevLL = JSON.parse(prev.ll_json);
    } catch {
        return false;
    }

    const timeDiffHours = (newTime - new Date(prev.created_at)) / 3600000;
    const distance = distanceKm(prevLL, newLL);

    if (distance && distance > TRAVEL_DISTANCE_KM && timeDiffHours < TRAVEL_HOURS) {
        return {
            distance: Math.round(distance),
            timeDiffHours: Math.round(timeDiffHours * 10) / 10,
            prevCity: prev.city || prev.country || 'unknown',
        };
    }
    return false;
}

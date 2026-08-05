// x-forwarded-for is client-controlled; only honor it behind a trusted
// reverse proxy (TRUST_PROXY=true), otherwise it lets attackers spoof
// trusted IPs and the localhost 2FA bypass.
export function getClientIP(req) {
    if (process.env.TRUST_PROXY === 'true') {
        const fwd = req.headers['x-forwarded-for'];
        if (fwd) {
            return fwd.split(',')[0].trim();
        }
    }
    const ip = req.socket?.remoteAddress || 'unknown';
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function isLocalhost(ip) {
    return ip === '127.0.0.1' || ip === '::1';
}

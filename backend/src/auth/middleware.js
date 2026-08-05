import { verifyAccessToken } from './tokens.js';

export function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization || '';
        const [scheme, token] = authHeader.split(' ');

        if (scheme !== 'Bearer' || !token) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const payload = verifyAccessToken(token);
        if (payload.purpose) {
            // 2FA temp tokens share JWT_SECRET but are not access tokens.
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.user = {
            id: payload.sub,
            email: payload.email,
            role: payload.role,
        };

        return next();
    } catch (_error) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
}

export function requireAdmin(req, res, next) {
    return requireAuth(req, res, () => {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden' });
        }

        return next();
    });
}

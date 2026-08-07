import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import timeout from 'connect-timeout';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import hpp from 'hpp';

import { hashPassword } from './auth/password.js';
import { config } from './config.js';
import { query } from './db/client.js';
import migrate from './db/migrate.js';
import { initAllJobs } from './jobs/jobManager.js';
import { globalLimiter } from './middleware/rateLimits.js';
import accountsRoutes from './routes/accounts.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import connectionsRoutes from './routes/connections.js';
import householdRoutes from './routes/household.js';
import importRoutes from './routes/import.js';
import goalsRoutes from './routes/goals.js';
import incomeRoutes from './routes/income.js';
import netWorthRoutes from './routes/netWorth.js';
import otherAssetsRoutes from './routes/otherAssets.js';
import performanceRoutes from './routes/performance.js';
import propertiesRoutes from './routes/properties.js';
import reportsRoutes from './routes/reports.js';
import scenariosRoutes from './routes/scenarios.js';
import taxRoutes from './routes/tax.js';
import settingsRoutes from './routes/settings.js';
import snapshotsRoutes from './routes/snapshots.js';
import snaptradeRoutes from './routes/snaptrade.js';
import transfersRoutes from './routes/transfers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Single .env at the repo root (same file docker-compose reads)
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err?.message || err);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

const app = express();
const port = config.port;

if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(cors({ origin: 'http://localhost:5178', credentials: true }));
app.use(hpp());
app.use(globalLimiter);

// Routes that stream (SSE) or run long operations can be exempted here.
const NO_TIMEOUT = [
    /\/events\//,
];
// Per-route timeout overrides, e.g. [/^\/api\/reports\/export/, '120s']
const TIMEOUT_OVERRIDES = [];

app.use((req, res, next) => {
    if (NO_TIMEOUT.some((re) => re.test(req.path))) {
        return next();
    }
    const override = TIMEOUT_OVERRIDES.find(([re]) => re.test(req.path));
    return timeout(override ? override[1] : '30s')(req, res, next);
});
app.use((req, res, next) => {
    if (!req.timedout) next();
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/settings', settingsRoutes);
// ADD YOUR APP ROUTES BELOW THIS LINE
app.use('/api/accounts', accountsRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/import', importRoutes);
app.use('/api/snapshots', snapshotsRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/snaptrade', snaptradeRoutes);
app.use('/api/transfers', transfersRoutes);
app.use('/api/performance', performanceRoutes);
app.use('/api/household', householdRoutes);
app.use('/api/other-assets', otherAssetsRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/net-worth', netWorthRoutes);
app.use('/api/scenarios', scenariosRoutes);
app.use('/api/tax', taxRoutes);
app.use('/api/income', incomeRoutes);
app.use('/api/reports', reportsRoutes);

app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

app.use((err, req, res, _next) => {
    const isDev = process.env.NODE_ENV === 'development';

    console.error('[Error]', err.message, err.stack);

    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Invalid JSON in request body' });
    }

    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request body too large' });
    }

    if (err.timeout) {
        return res.status(503).json({ error: 'Request timeout' });
    }

    return res.status(err.status || 500).json({
        error: isDev ? err.message : 'Internal server error',
        ...(isDev && { stack: err.stack }),
    });
});

const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const USE_HTTPS = process.env.USE_HTTPS === 'true';
// 127.0.0.1 for bare-metal dev (frontend proxies to it); Docker sets
// HOST=0.0.0.0 so the container port is reachable.
const HOST = process.env.HOST || '127.0.0.1';

function hardenServer(server) {
    server.headersTimeout = 15000;
    server.requestTimeout = 30000;
    server.keepAliveTimeout = 5000;
    return server;
}

async function startServer() {
    await migrate();
    await ensureAdminUser();
    await initAllJobs();

    if (USE_HTTPS) {
        const sslOptions = {
            key: readFileSync(process.env.SSL_KEY_PATH),
            cert: readFileSync(process.env.SSL_CERT_PATH),
        };

        hardenServer(https.createServer(sslOptions, app)).listen(HTTPS_PORT, HOST, () => {
            console.log(`HTTPS server on ${HOST}:${HTTPS_PORT}`);
        });

        hardenServer(http.createServer((req, res) => {
            res.writeHead(301, { Location: `https://localhost:${HTTPS_PORT}${req.url}` });
            res.end();
        })).listen(port, HOST, () => {
            console.log(`HTTP redirect on ${HOST}:${port} → HTTPS`);
        });
    } else {
        hardenServer(http.createServer(app)).listen(port, HOST, () => {
            console.log(`HTTP server on ${HOST}:${port}`);
        });
    }
}

// First-run bootstrap: creates an admin account from ADMIN_EMAIL /
// ADMIN_PASSWORD when the users table is empty. Change the password
// immediately after first login.
async function ensureAdminUser() {
    const countResult = await query('SELECT COUNT(*)::int AS count FROM users');
    const userCount = countResult.rows[0]?.count ?? 0;

    if (userCount > 0) {
        return;
    }

    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
        console.warn('No users exist and admin bootstrap credentials are missing');
        return;
    }

    const passwordHash = await hashPassword(process.env.ADMIN_PASSWORD);
    await query(
        `
        INSERT INTO users (email, password_hash, role, is_active)
        VALUES ($1, $2, 'admin', true)
        `,
        [process.env.ADMIN_EMAIL, passwordHash]
    );

    console.warn('Admin user created from environment settings. Change ADMIN_PASSWORD immediately.');
}

startServer();

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import pool from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function migrate() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = await fs.readFile(schemaPath, 'utf8');

    try {
        await pool.query(schemaSql);
        console.log('Database migrations complete');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

export default migrate;

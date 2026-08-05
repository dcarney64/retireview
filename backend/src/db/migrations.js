import { query } from './client.js';

export async function migrationApplied(version) {
    const { rows } = await query(
        'SELECT id FROM schema_migrations WHERE version = $1',
        [version]
    );
    return rows.length > 0;
}

export async function recordMigration(version, description) {
    await query(
        `INSERT INTO schema_migrations (version, description)
         VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
        [version, description]
    );
}

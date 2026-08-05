import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../../.env') });

export const config = {
    port: Number(process.env.PORT || 8006),

    // Default request timeout budget for outbound API calls
    apiRequestTimeoutMs: Number(process.env.API_REQUEST_TIMEOUT_MS) || 30000,

    // ADD YOUR APP CONFIG BELOW THIS LINE
};

export default config;

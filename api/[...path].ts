import type { Request, Response } from 'express';
import { createApp } from '../src/app.js';
import { assertAppRoleIsSafe } from '../src/db/pool.js';
import { config } from '../src/config.js';

if (process.env['VERCEL'] === '1' && config.STORAGE_DRIVER !== 's3') {
    throw new Error('Vercel deployments require STORAGE_DRIVER=s3 because function filesystems are ephemeral.');
}

const app = createApp();
let roleCheck: Promise<void> | undefined;

export default function handler(req: Request, res: Response): void {
    roleCheck ??= assertAppRoleIsSafe().then(() => undefined);
    void roleCheck.then(
        () => app(req, res),
        (error: unknown) => {
            console.error('[hq] API database role validation failed:', error);
            if (!res.headersSent) {
                res.status(503).json({
                    error: {
                        code: 'SERVICE_UNAVAILABLE',
                        message: 'The API is not ready to serve requests.',
                    },
                });
            }
        },
    );
}

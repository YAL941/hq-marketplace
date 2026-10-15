import type { Request, Response } from 'express';
import handler from './[...path].js';

export default function apiHandler(req: Request, res: Response): void {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    const apiPath = requestUrl.searchParams.get('__api_path');

    if (apiPath !== null) {
        requestUrl.searchParams.delete('__api_path');
        const query = requestUrl.searchParams.toString();
        req.url = `/api/${apiPath.replace(/^\/+/, '')}${query ? `?${query}` : ''}`;
    }

    handler(req, res);
}

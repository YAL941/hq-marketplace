import { z } from 'zod';

export const HTTP_URL_ERROR = 'Must be an http or https URL';

export function httpUrlProblem(value: string): string | undefined {
    if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value) || value.startsWith('//')) {
        return HTTP_URL_ERROR;
    }

    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return HTTP_URL_ERROR;
    }

    return url.protocol === 'http:' || url.protocol === 'https:' ? undefined : HTTP_URL_ERROR;
}

export const httpUrlSchema = z.string().min(1).max(500).superRefine((value, ctx) => {
    const problem = httpUrlProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
});

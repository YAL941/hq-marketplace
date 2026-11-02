export function isStrongSecret(value: unknown): boolean;
export function compareComposeVersions(actual: string, minimum?: number[]): boolean;
export function validateComposeEnvironment(
    env: NodeJS.ProcessEnv,
    readSecret?: (path: string) => Promise<string>,
): Promise<string[]>;

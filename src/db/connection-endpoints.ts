export type ManagedPostgresMode = 'local' | 'managed';

export interface DirectMigrationEndpointOptions {
    directHost?: string;
    managedMode: ManagedPostgresMode;
}

const knownPoolHostnamePatterns = [
    /(^|\.)[^.]*-pooler(?:\.|$)/i,
    /\.pooler\.[^.]+\.[^.]+(?:\.[^.]+)?$/i,
];

export function isKnownPooledHostname(hostname: string): boolean {
    const value = hostname.trim().toLowerCase();
    return knownPoolHostnamePatterns.some((pattern) => pattern.test(value));
}

/**
 * Migration/admin connections must be explicitly pointed at the provider's
 * direct endpoint. Hostname matching is only a guard against well-known
 * pooled hostnames; the operator remains responsible for supplying the real
 * provider direct endpoint.
 */
export function resolveDirectMigrationHost(options: DirectMigrationEndpointOptions): string {
    const directHost = options.directHost?.trim();
    if (!directHost) {
        if (options.managedMode === 'managed') {
            throw new Error('PG_DIRECT_HOST is required when PG_MANAGED_MODE=managed');
        }
        throw new Error('PG_DIRECT_HOST is required for migration/admin connections; PGHOST is not used as a fallback');
    }
    if (isKnownPooledHostname(directHost)) {
        throw new Error('PG_DIRECT_HOST must be the provider direct endpoint, not a known transaction-pooling hostname');
    }
    return directHost;
}

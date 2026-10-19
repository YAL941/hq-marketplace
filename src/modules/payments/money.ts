const DECIMAL_AMOUNT = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/;

export function decimalToMinorUnits(value: string): bigint {
    const match = DECIMAL_AMOUNT.exec(value);
    if (!match) throw new Error('Amount must be a non-negative decimal with at most two fractional digits');
    const whole = BigInt(match[1]!);
    const fractional = BigInt((match[2] ?? '').padEnd(2, '0') || '0');
    return whole * 100n + fractional;
}

export function minorUnitsToDecimal(value: bigint): string {
    if (value < 0n) throw new Error('Minor-unit amount cannot be negative');
    const whole = value / 100n;
    const fraction = String(value % 100n).padStart(2, '0');
    return `${whole}.${fraction}`;
}

export function calculateCommission(subtotalMinor: bigint, rateUsedBps: number): bigint {
    if (subtotalMinor < 0n) throw new Error('Subtotal cannot be negative');
    if (!Number.isInteger(rateUsedBps) || rateUsedBps < 0 || rateUsedBps > 10_000) {
        throw new Error('Commission rate must be an integer from 0 to 10000 basis points');
    }
    return (subtotalMinor * BigInt(rateUsedBps) + 5_000n) / 10_000n;
}

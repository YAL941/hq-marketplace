import { describe, expect, it } from 'vitest';
import { getSafeInternalRedirect } from './internalRedirect';

describe('getSafeInternalRedirect', () => {
  it.each([
    ['/orders', '/orders'],
    ['/orders/123?view=full#details', '/orders/123?view=full#details'],
    ['/explore?category=electronics', '/explore?category=electronics'],
    ['/dashboard/business/42/products', '/dashboard/business/42/products'],
  ])('allows valid internal path %s', (input, expected) => {
    expect(getSafeInternalRedirect(input)).toBe(expected);
  });

  it.each([
    ['https://evil.example/orders', '/'],
    ['//evil.example/orders', '/'],
    ['/\\evil.example/orders', '/'],
    ['/%5cevil.example/orders', '/'],
    ['/%255cevil.example/orders', '/'],
    ['/../orders', '/'],
    ['/orders%2F..%2Fevil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/orders%zz', '/'],
    ['', '/'],
    [null, '/'],
  ])('rejects unsafe destination %j', (input, expected) => {
    expect(getSafeInternalRedirect(input)).toBe(expected);
  });

  it('preserves a supplied safe fallback', () => {
    expect(getSafeInternalRedirect('//evil.example', '/dashboard')).toBe('/dashboard');
  });
});

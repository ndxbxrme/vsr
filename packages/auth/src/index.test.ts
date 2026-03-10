import { describe, expect, it } from 'vitest';
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from './index';

describe('auth helpers', () => {
  it('hashes and verifies a password', () => {
    const hash = hashPassword('secret-123');

    expect(verifyPassword('secret-123', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  it('creates opaque tokens', () => {
    expect(createOpaqueToken()).toHaveLength(64);
  });

  it('normalizes email addresses', () => {
    expect(normalizeEmail('  Test@Example.COM ')).toBe('test@example.com');
  });

  it('hashes opaque tokens', () => {
    expect(hashOpaqueToken('abc')).toHaveLength(64);
  });
});

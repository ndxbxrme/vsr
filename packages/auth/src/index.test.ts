import { describe, expect, it } from 'vitest';
import { createOpaqueToken, hashPassword, verifyPassword } from './index';

describe('auth helpers', () => {
  it('hashes and verifies a password', () => {
    const hash = hashPassword('secret-123');

    expect(verifyPassword('secret-123', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  it('creates opaque tokens', () => {
    expect(createOpaqueToken()).toHaveLength(64);
  });
});

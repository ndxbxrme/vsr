import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${digest}`;
}

export function verifyPassword(password: string, hash: string): boolean {
  const [salt, storedDigest] = hash.split(':');
  if (!salt || !storedDigest) {
    return false;
  }

  const candidate = scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(storedDigest, 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

export function createOpaqueToken(size = 32): string {
  return randomBytes(size).toString('hex');
}

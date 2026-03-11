import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const KEY_LENGTH = 64;
const ENCRYPTION_IV_LENGTH = 12;

type EncryptedJsonEnvelope = {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
};

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

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function deriveEncryptionKey(secret: string) {
  if (!secret || secret.trim().length < 16) {
    throw new Error('encryption_secret_too_short');
  }

  return createHash('sha256').update(secret).digest();
}

export function encryptJsonPayload(value: unknown, secret: string): EncryptedJsonEnvelope {
  const iv = randomBytes(ENCRYPTION_IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', deriveEncryptionKey(secret), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function isEncryptedJsonEnvelope(value: unknown): value is EncryptedJsonEnvelope {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<EncryptedJsonEnvelope>;
  return (
    candidate.version === 1 &&
    candidate.algorithm === 'aes-256-gcm' &&
    typeof candidate.iv === 'string' &&
    typeof candidate.tag === 'string' &&
    typeof candidate.ciphertext === 'string'
  );
}

export function decryptJsonPayload<T>(value: unknown, secret: string): T {
  if (!isEncryptedJsonEnvelope(value)) {
    return value as T;
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    deriveEncryptionKey(secret),
    Buffer.from(value.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

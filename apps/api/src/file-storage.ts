import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

function resolveStorageRoot() {
  return process.env.FILE_STORAGE_ROOT ?? path.resolve(process.cwd(), '.data', 'uploads');
}

export async function persistUploadedFile(args: {
  tenantId: string;
  originalName: string;
  base64Data: string;
}) {
  const root = resolveStorageRoot();
  const safeName = args.originalName.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const storageKey = path.join(args.tenantId, `${randomUUID()}-${safeName}`);
  const targetPath = path.join(root, storageKey);
  await mkdir(path.dirname(targetPath), { recursive: true });
  const buffer = Buffer.from(args.base64Data, 'base64');
  await writeFile(targetPath, buffer);
  return {
    storageProvider: 'local',
    storageKey,
    sizeBytes: buffer.byteLength,
  };
}

export async function loadStoredFile(storageKey: string) {
  const root = resolveStorageRoot();
  return readFile(path.join(root, storageKey));
}

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../../config';

export interface StorageAdapter {
  put(key: string, body: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  health(): Promise<boolean>;
}

function localStorage(root: string): StorageAdapter {
  const base = resolve(root);
  const pathFor = (key: string) => {
    const p = resolve(join(base, key));
    if (!p.startsWith(base + sep)) throw new Error('Invalid storage key'); // path traversal guard
    return p;
  };
  return {
    async put(key, body) {
      const p = pathFor(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    get: (key) => readFile(pathFor(key)),
    delete: (key) => rm(pathFor(key), { force: true }),
    async health() {
      await mkdir(base, { recursive: true });
      return true;
    },
  };
}

function s3Storage(): StorageAdapter {
  const client = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: !!config.S3_ENDPOINT,
    credentials: config.S3_ACCESS_KEY ? { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY ?? '' } : undefined,
  });
  const Bucket = config.S3_BUCKET!;
  return {
    async put(key, body, mime) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: mime, ServerSideEncryption: config.S3_ENDPOINT ? undefined : 'AES256' }));
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await res.Body!.transformToByteArray());
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async health() {
      await client.send(new HeadBucketCommand({ Bucket }));
      return true;
    },
  };
}

export const storage: StorageAdapter = config.STORAGE_DRIVER === 's3' ? s3Storage() : localStorage(config.STORAGE_DIR);

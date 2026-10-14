import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 128 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('base64url')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, salt, digest] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !digest) return false;
  const expected = Buffer.from(digest, 'base64url');
  const actual = await derive(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export function newSessionToken(): string { return randomBytes(32).toString('base64url'); }

// 不存在的用户名也进行同等成本的密码校验。
export const DUMMY_HASH = `scrypt$worksync-dummy-salt$${Buffer.alloc(64).toString('base64url')}`;

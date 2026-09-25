import { hashPassword, sha256, verifyPassword, verifyPasswordDummy } from '../../src/utils/crypto';

jest.setTimeout(30000);

describe('crypto', () => {
  it('hashes passwords with Argon2id and verifies them', async () => {
    const hash = await hashPassword('SecurePassword123!');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).toContain('m=65536');
    expect(hash).toContain('t=3');
    expect(hash).toContain('p=4');
    await expect(verifyPassword(hash, 'SecurePassword123!')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'WrongPassword123!')).resolves.toBe(false);
  });

  it('runs a dummy verification without throwing', async () => {
    await expect(verifyPasswordDummy('SecurePassword123!')).resolves.toBeUndefined();
  });

  it('returns a stable SHA-256 hex digest', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import { createTokenVerifier } from '../src/auth.js';
import { authConfig, key, sign, verifyToken } from './support.js';

const token = (claims: Record<string, unknown>, algorithm = 'HS256') => new SignJWT(claims)
  .setProtectedHeader({ alg: algorithm }).sign(key);
const valid = () => ({ sub: 'alice', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60,
  iss: authConfig.issuer, aud: authConfig.audience });

test('valid tokens resolve only the identity and expiration needed by presence', async () => {
  const result = await verifyToken(await sign('alice'));
  assert.equal(result.userId, 'alice');
  assert.ok(result.expiresAt > Date.now());
});

test('missing/expired claims, wrong issuer/audience, algorithm and signature are rejected', async () => {
  for (const claims of [
    { ...valid(), exp: 1 }, { ...valid(), exp: undefined }, { ...valid(), iat: undefined },
    { ...valid(), sub: undefined }, { ...valid(), sub: '' },
    { ...valid(), iss: 'wrong' }, { ...valid(), aud: 'wrong' },
    { ...valid(), nbf: Math.floor(Date.now() / 1000) + 600 }
  ]) await assert.rejects(verifyToken(await token(claims)));
  await assert.rejects(verifyToken(await token(valid(), 'HS384')));
  const wrongKey = new TextEncoder().encode('a-different-test-only-key-with-32-bytes');
  await assert.rejects(verifyToken(await new SignJWT(valid()).setProtectedHeader({ alg: 'HS256' }).sign(wrongKey)));
});

test('verifier refuses an absent/short signing key or missing issuer/audience', () => {
  assert.throws(() => createTokenVerifier({ ...authConfig, secret: '' }));
  assert.throws(() => createTokenVerifier({ ...authConfig, issuer: '' }));
  assert.throws(() => createTokenVerifier({ ...authConfig, audience: '' }));
});

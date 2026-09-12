import { jwtVerify } from 'jose';

export interface Identity { userId: string; expiresAt: number }
export type VerifyToken = (token: string) => Promise<Identity>;

// Auth is an injected boundary: this service verifies tokens, never issues them.
// The current repository has no auth implementation to reuse. The future issuer
// must supply HS256 tokens with matching issuer/audience, sub, iat, and exp.
export function createTokenVerifier(config: { secret: string; issuer: string; audience: string }): VerifyToken {
  if (Buffer.byteLength(config.secret, 'utf8') < 32 || !config.issuer.trim() || !config.audience.trim()) {
    throw new Error('JWT_SECRET must contain at least 32 bytes; JWT_ISSUER and JWT_AUDIENCE are required');
  }
  const key = new TextEncoder().encode(config.secret);
  return async (token) => {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ['sub', 'iat', 'exp']
    });
    if (!payload.sub?.trim() || payload.sub.length > 128 || typeof payload.exp !== 'number') {
      throw new Error('Invalid token identity');
    }
    return { userId: payload.sub, expiresAt: payload.exp * 1000 };
  };
}

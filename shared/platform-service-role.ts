/**
 * Authorize claims only after Supabase's gateway has verified the JWT signature.
 * This is not a JWT signature verifier. The hosted function MUST retain
 * verify_jwt=true; ordinary user tokens never receive the service_role claim.
 */
export function hasVerifiedPlatformServiceRole(
  header: string | null,
  projectRef: string,
  now = Date.now(),
): boolean {
  if (!header?.startsWith('Bearer ') || header.length > 4096) return false;
  const parts = header.slice(7).split('.');
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
  try {
    const decode = (part: string): unknown =>
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(
          Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
        ),
      );
    const jwtHeader = decode(parts[0]) as Record<string, unknown>;
    const claims = decode(parts[1]) as Record<string, unknown>;
    return (
      jwtHeader !== null &&
      ['HS256', 'ES256', 'RS256'].includes(String(jwtHeader.alg)) &&
      claims !== null &&
      claims.role === 'service_role' &&
      claims.ref === projectRef &&
      claims.iss === 'supabase' &&
      typeof claims.exp === 'number' &&
      Number.isFinite(claims.exp) &&
      claims.exp * 1000 > now
    );
  } catch {
    return false;
  }
}

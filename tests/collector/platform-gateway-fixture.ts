/** Synthetic gateway used only in tests to model Supabase's JWT verification. */
export function fixtureJwtGateway(
  handler: (request: Request) => Promise<Response>,
  secret: string,
) {
  const encoder = new TextEncoder();
  const key = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return async (request: Request): Promise<Response> => {
    try {
      const header = request.headers.get('authorization');
      if (!header?.startsWith('Bearer ') || header.length > 4096) throw new Error('Missing JWT');
      const [head, payload, signature, extra] = header.slice(7).split('.');
      if (!head || !payload || !signature || extra !== undefined) throw new Error('Malformed JWT');
      const decode = (value: string) =>
        Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const algorithm = JSON.parse(new TextDecoder().decode(decode(head))) as { alg?: string };
      const claims = JSON.parse(new TextDecoder().decode(decode(payload))) as { exp?: number };
      if (
        algorithm.alg !== 'HS256' ||
        typeof claims.exp !== 'number' ||
        claims.exp * 1000 <= Date.now()
      )
        throw new Error('Invalid JWT');
      if (
        !(await crypto.subtle.verify(
          'HMAC',
          await key,
          decode(signature),
          encoder.encode(head + '.' + payload),
        ))
      )
        throw new Error('Invalid signature');
    } catch {
      return Response.json({ code: 'fixture_invalid_jwt' }, { status: 401 });
    }
    return handler(request);
  };
}

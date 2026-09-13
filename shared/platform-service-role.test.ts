import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fixtureJwtGateway } from '../tests/collector/platform-gateway-fixture';
import { createStatusCollector } from './status-collector';
import { hasVerifiedPlatformServiceRole } from './platform-service-role';

const ref = 'abcdefghijklmnopqrst';
const signingKey = 'synthetic-platform-signing-key-longer-than-32';
function token(claims: Record<string, unknown> = {}, key = signingKey) {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({
      iss: 'supabase',
      ref,
      role: 'service_role',
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    }),
  ).toString('base64url');
  return (
    head +
    '.' +
    body +
    '.' +
    createHmac('sha256', key)
      .update(head + '.' + body)
      .digest('base64url')
  );
}

describe('platform verified service-role authorization', () => {
  for (const [name, value] of [
    ['missing token', null],
    ['malformed token', 'Bearer invalid'],
    ['anonymous JWT', 'Bearer ' + token({ role: 'anon' })],
    [
      'ordinary user JWT',
      'Bearer ' + token({ role: 'authenticated', app_metadata: { role: 'service_role' } }),
    ],
    ['foreign project', 'Bearer ' + token({ ref: 'anotherprojectrefabc' })],
    ['wrong issuer', 'Bearer ' + token({ iss: 'external' })],
    ['expired service JWT', 'Bearer ' + token({ exp: 1 })],
    ['forged service-role signature', 'Bearer ' + token({}, 'different-synthetic-key')],
  ] as const) {
    it(`rejects ${name} before database work`, async () => {
      const rpc = vi.fn();
      const handler = fixtureJwtGateway(
        createStatusCollector({
          secret: 'different-runtime-database-key-longer-than-32',
          rpc,
          authorizeVerifiedRequest: (request) =>
            hasVerifiedPlatformServiceRole(request.headers.get('authorization'), ref),
        }),
        signingKey,
      );
      const response = await handler(
        new Request('https://collector.invalid', {
          method: 'POST',
          headers: value ? { authorization: value } : {},
        }),
      );
      expect(response.status).toBe(401);
      expect(rpc).not.toHaveBeenCalled();
    });
  }

  it('accepts the project service JWT even when the runtime database credential differs', async () => {
    const rpc = vi.fn().mockResolvedValue({ state: 'disabled' });
    const handler = fixtureJwtGateway(
      createStatusCollector({
        secret: 'different-runtime-database-key-longer-than-32',
        rpc,
        authorizeVerifiedRequest: (request) =>
          hasVerifiedPlatformServiceRole(request.headers.get('authorization'), ref),
      }),
      signingKey,
    );
    const response = await handler(
      new Request('https://collector.invalid', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token() },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'disabled', checked: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('keeps the required signature-verification gateway enabled in deployment configuration', () => {
    const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
    expect(config).toMatch(/\[functions\.status-uptime-collector\]\s+verify_jwt\s*=\s*true/);
    expect(config).not.toMatch(/verify_jwt\s*=\s*false/);
  });
});

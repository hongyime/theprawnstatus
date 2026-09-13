import { createCollectorRpc, createStatusCollector } from '../../../shared/status-collector.ts';
import { hasVerifiedPlatformServiceRole } from '../../../shared/platform-service-role.ts';

// Supabase verifies the signature before this handler; authorize the service role
// for this project. Never disable verify_jwt for this entrypoint.
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const url = Deno.env.get('SUPABASE_URL') ?? '';

const handler = createStatusCollector({
  secret: serviceKey,
  authorizeVerifiedRequest: (request) =>
    hasVerifiedPlatformServiceRole(
      request.headers.get('authorization'),
      new URL(url).hostname.split('.')[0],
    ),
  rpc: createCollectorRpc(url, serviceKey),
});
Deno.serve(handler);

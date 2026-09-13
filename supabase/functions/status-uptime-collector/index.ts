import { createCollectorRpc, createStatusCollector } from '../../../shared/status-collector.ts';

// Keep platform JWT verification enabled. A separate private collector secret
// avoids depending on the platform's database credential or bearer forwarding.
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const url = Deno.env.get('SUPABASE_URL') ?? '';

const handler = createStatusCollector({
  secret: Deno.env.get('STATUS_COLLECTOR_SECRET') ?? '',
  authorizationHeader: 'x-status-collector-authorization',
  rpc: createCollectorRpc(url, serviceKey),
});
Deno.serve(handler);

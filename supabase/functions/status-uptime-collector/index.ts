import { createCollectorRpc, createStatusCollector } from '../../../shared/status-collector.ts';

// Keep platform JWT verification enabled. The handler additionally accepts only
// the project's server credential, so an ordinary signed-in user cannot collect.
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const url = Deno.env.get('SUPABASE_URL') ?? '';

const handler = createStatusCollector({
  secret: serviceKey,
  rpc: createCollectorRpc(url, serviceKey),
});
Deno.serve(handler);

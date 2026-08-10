import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';

import { Banner } from './components/Banner';
import { ComplianceTrend } from './components/ComplianceTrend';
import { HealthTable } from './components/HealthTable';
import { TargetRow } from './components/TargetRow';
import { formatRelativeTime } from './lib/format';
import { useHealthData } from './hooks/useHealthData';
import { useStatusData } from './hooks/useStatusData';

function App(): ReactNode {
  const status = useStatusData();
  const health = useHealthData();
  const loadedTargets = status.data?.targets ?? [];
  const liveSource = status.source === 'live' && health.source === 'live';

  return (
    <div className="min-h-screen">
      <header className="border-b-3 border-ink bg-paper">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:flex-row md:items-end md:justify-between md:px-6">
          <div className="min-w-0">
            <a
              className="focus-ring inline-flex items-center gap-1 font-display text-xs font-bold uppercase opacity-70 hover:opacity-100"
              href="https://theprawnprojects.vercel.app/"
              target="_blank"
              rel="noreferrer"
            >
              The Prawn Projects
              <ExternalLink aria-hidden="true" className="h-3 w-3" />
            </a>
            <h1 className="mt-2 max-w-full font-display text-[clamp(2.05rem,9vw,5.5rem)] font-bold uppercase leading-none tracking-normal sm:text-[clamp(2.3rem,7vw,5.5rem)]">
              The Prawn{' '}
              <span className="inline-block -skew-x-6 border-3 border-ink bg-neo px-2 shadow-hardSm">Status</span>
            </h1>
          </div>
          <div className="grid grid-cols-2 border-3 border-ink bg-paper text-right font-display text-xs font-bold uppercase shadow-hardSm tabular sm:min-w-[320px]">
            <div className="border-r-3 border-ink px-3 py-2">
              Data
              <br />
              <strong>{liveSource ? 'Live' : status.source ?? 'Loading'}</strong>
            </div>
            <div className="px-3 py-2">
              Last Check
              <br />
              <strong>{formatRelativeTime(status.data?.generated_at ?? null)}</strong>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 md:px-6">
        <div className="grid gap-2 md:grid-cols-2">
          {status.source === 'snapshot' ? (
            <Banner tone="warn">Live status data unavailable; showing the build snapshot.</Banner>
          ) : null}
          {status.stale ? <Banner tone="error">Status data is stale. Current state is not green.</Banner> : null}
          {status.error !== null && status.source === null ? (
            <Banner tone="error">Status data failed to load.</Banner>
          ) : null}
          {health.source === 'snapshot' ? (
            <Banner tone="warn">Live health data unavailable; showing the build snapshot.</Banner>
          ) : null}
          {health.report !== null && health.stale ? <Banner tone="warn">Repo health data is stale.</Banner> : null}
        </div>

        <section className="space-y-3">
          <div className="flex flex-col gap-2 border-3 border-ink bg-paper p-3 shadow-hard md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-2xl font-bold uppercase">Deployments</h2>
              <p className="font-display text-xs font-bold uppercase tabular opacity-70">
                {loadedTargets.length} targets - sampled every ~15 min - page refreshes every 60s
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                className="focus-ring inline-flex h-9 items-center justify-center gap-2 border-3 border-ink bg-paper px-3 font-display text-xs font-bold uppercase shadow-hardSm hover:bg-neo"
                href="https://theprawnprojects.vercel.app/"
                target="_blank"
                rel="noreferrer"
              >
                Projects
              </a>
              <a
                className="focus-ring inline-flex h-9 items-center justify-center gap-2 border-3 border-ink bg-paper px-3 font-display text-xs font-bold uppercase shadow-hardSm hover:bg-neo"
                href="https://github.com/hongyime/theprawnstatus"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </div>
          </div>

          {status.loading ? (
            <div className="border-3 border-ink bg-paper p-4 font-display font-bold uppercase shadow-hard">Loading status data</div>
          ) : loadedTargets.length === 0 ? (
            <div className="border-3 border-ink bg-paper p-4 font-display font-bold uppercase shadow-hard">
              No deployment samples yet
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {loadedTargets.map((target) => (
                <TargetRow
                  key={target.id}
                  target={target}
                  generatedAt={status.data?.generated_at ?? null}
                  stale={status.stale}
                />
              ))}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
          <HealthTable report={health.report} loading={health.loading} stale={health.stale} />
          <ComplianceTrend history={health.history} />
        </div>
      </main>

      <footer className="border-t-3 border-ink bg-ink px-4 py-5 text-paper md:px-6">
        <div className="mx-auto max-w-7xl font-display text-xs font-bold uppercase">
          The Prawn Status is an extension of The Prawn Projects. Uptime is indicative, not an SLA.
        </div>
      </footer>
    </div>
  );
}

export default App;

import type { ReactNode } from 'react';

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

  return (
    <div className="min-h-screen">
      <header className="border-b-3 border-ink bg-paper">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 md:flex-row md:items-end md:justify-between md:px-6">
          <div>
            <p className="font-mono text-sm uppercase tabular">hongyime estate</p>
            <h1 className="font-display text-5xl uppercase leading-none md:text-7xl">The Prawn Status</h1>
          </div>
          <div className="border-3 border-ink bg-pink px-4 py-3 text-right font-mono text-sm shadow-hardSm tabular">
            Last checked
            <br />
            <strong>{formatRelativeTime(status.data?.generated_at ?? null)}</strong>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 md:px-6">
        <div className="space-y-4">
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

        <section className="space-y-4">
          <div className="flex flex-col gap-2 border-3 border-ink bg-cyan p-4 shadow-hard md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-display text-3xl uppercase">Deployments</h2>
              <p className="font-mono text-sm tabular">{loadedTargets.length} targets - sampled every ~15 min</p>
            </div>
            <a
              className="focus-ring inline-flex h-10 items-center justify-center border-3 border-ink bg-paper px-3 font-display text-sm uppercase shadow-hardSm"
              href="https://github.com/hongyime/theprawnstatus"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>

          {status.loading ? (
            <div className="border-3 border-ink bg-paper p-6 font-display uppercase shadow-hard">Loading status data</div>
          ) : loadedTargets.length === 0 ? (
            <div className="border-3 border-ink bg-paper p-6 font-display uppercase shadow-hard">
              No deployment samples yet
            </div>
          ) : (
            <div className="space-y-4">
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

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_360px]">
          <HealthTable report={health.report} loading={health.loading} stale={health.stale} />
          <ComplianceTrend history={health.history} />
        </div>
      </main>

      <footer className="border-t-3 border-ink bg-ink px-4 py-6 text-paper md:px-6">
        <div className="mx-auto max-w-7xl font-mono text-sm">
          Uptime is sampled every ~15 minutes and is indicative, not an SLA. theprawnstatus reports drift; it
          does not fix repos or handle identity scan data.
        </div>
      </footer>
    </div>
  );
}

export default App;

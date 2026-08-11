import type { ReactNode } from 'react';

import { Banner } from './components/Banner';
import { HealthTable } from './components/HealthTable';
import { TargetRow } from './components/TargetRow';
import { useHealthData } from './hooks/useHealthData';
import { useStatusData } from './hooks/useStatusData';

function App(): ReactNode {
  const status = useStatusData();
  const health = useHealthData();
  const loadedTargets = status.data?.targets ?? [];

  return (
    <div className="min-h-screen">
      <header className="border-b-3 border-ink bg-paper">
        <div className="mx-auto flex max-w-7xl items-center justify-center overflow-hidden px-4 py-6 md:px-6 md:py-8">
          <h1 className="w-full whitespace-nowrap text-center font-display text-[8vw] font-bold uppercase leading-none tracking-normal sm:text-5xl md:text-7xl lg:text-8xl">
            The Prawn{' '}
            <span className="ml-1 inline-block -skew-x-6 border-3 border-ink bg-neo px-2 shadow-hardSm sm:ml-4">
              Status
            </span>
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 md:px-6">
        <div className="grid gap-2 md:grid-cols-2">
          {status.source === 'snapshot' ? (
            <Banner tone="warn">Live status data unavailable; showing the build snapshot.</Banner>
          ) : null}
          {status.stale ? (
            <Banner tone="error">Status data is stale. Current state is not green.</Banner>
          ) : null}
          {status.error !== null && status.source === null ? (
            <Banner tone="error">Status data failed to load.</Banner>
          ) : null}
          {health.source === 'snapshot' ? (
            <Banner tone="warn">Live health data unavailable; showing the build snapshot.</Banner>
          ) : null}
          {health.report !== null && health.stale ? (
            <Banner tone="warn">Repo health data is stale.</Banner>
          ) : null}
        </div>

        <section className="space-y-3">
          <div className="flex flex-col gap-2 border-3 border-ink bg-paper p-3 shadow-hard md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-display text-2xl font-bold uppercase">Deployments</h2>
              <p className="font-display text-xs font-bold uppercase tabular opacity-70">
                {loadedTargets.length} targets - scheduled ~5 min - stale after 20 min - page
                refreshes every 60s
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
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
            <div className="border-3 border-ink bg-paper p-4 font-display font-bold uppercase shadow-hard">
              Loading status data
            </div>
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

        <HealthTable
          report={health.report}
          history={health.history}
          loading={health.loading}
          stale={health.stale}
        />
      </main>

      <footer className="mx-auto max-w-7xl border-t-3 border-ink px-4 pb-12 pt-8 md:px-6">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <h4 className="font-display text-3xl font-bold uppercase md:text-4xl">Get In Touch</h4>
          <div className="flex flex-col items-center gap-2">
            <a
              className="focus-ring border-b-3 border-ink font-display text-base font-bold uppercase hover:bg-neo"
              href="mailto:hello@hong-yi.me"
            >
              hello@hong-yi.me
            </a>
            <a
              className="focus-ring border-b-3 border-ink font-display text-base font-bold uppercase hover:bg-neo"
              href="https://www.hong-yi.me"
              target="_blank"
              rel="noreferrer"
            >
              www.hong-yi.me
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;

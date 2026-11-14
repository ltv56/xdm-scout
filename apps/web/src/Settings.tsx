import { useQuery } from '@tanstack/react-query'
import type { PreflightRow, PreflightStatus } from '../../api/src/preflight/contract'
import { getJson } from './api'
import { btnSecondary } from './ui'

const DOT: Record<PreflightStatus, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  fail: 'bg-block',
  info: 'bg-rule',
}

const WORD: Record<PreflightStatus, string> = { ok: 'OK', warn: 'Check', fail: 'Fix', info: '' }

export default function Settings() {
  const checks = useQuery<PreflightRow[]>({ queryKey: ['preflight'], queryFn: () => getJson('/preflight'), retry: false })

  return (
    <div className="space-y-12">
      <h2 className="text-[28px] font-semibold leading-tight">Settings</h2>
      <section aria-label="Setup check" className="max-w-xl">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-xl font-bold">Setup check</h3>
          <button type="button" className={btnSecondary} disabled={checks.isFetching} onClick={() => void checks.refetch()}>
            Run checks again
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">Everything xdm-scout needs to run, and what to do about anything that is not ready.</p>
        {checks.error && (
          <p role="alert" className="mt-4 text-sm text-block">
            Could not run the checks: {checks.error.message}
          </p>
        )}
        <ul className="mt-4 divide-y divide-rule rounded-2xl border border-rule bg-paper">
          {(checks.data ?? []).map((r) => (
            <li key={r.id} className="flex gap-3 px-5 py-3.5">
              <span aria-hidden className={`mt-1.5 size-2.5 shrink-0 rounded-full ${DOT[r.status]}`} />
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {r.label}
                  {WORD[r.status] && <span className="ml-2 text-xs font-medium text-muted">{WORD[r.status]}</span>}
                </p>
                <p className="text-sm text-muted">{r.detail}</p>
                {r.fix && <p className="mt-0.5 text-sm">{r.fix}</p>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

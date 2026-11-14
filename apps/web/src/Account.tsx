import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getJson, postJson } from './api'
import SenderProfile from './SenderProfile'
import { XLogo } from './icons'
import { btnSecondary } from './ui'

interface XStatus {
  mode: 'fake' | 'live'
  connected: boolean
  handle: string | null
  tokenExpiresAt: string | null
  missingScopes: string[]
}

function XAccount() {
  const qc = useQueryClient()
  const status = useQuery<XStatus>({ queryKey: ['x-status'], queryFn: () => getJson('/auth/x/status') })
  const useSandbox = useMutation({
    mutationFn: () => postJson('/auth/x/fake'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['x-status'] }),
  })
  const s = status.data
  const needsReconnect = !!s?.connected && s.missingScopes.length > 0
  const title = !s ? 'Checking…' : !s.connected ? 'Not connected' : `@${s.handle}`
  const note = !s
    ? ''
    : !s.connected
      ? 'Sending replies from here is switched off.'
      : needsReconnect
        ? `Reconnect to grant: ${s.missingScopes.join(', ')}.`
        : s.mode === 'fake'
          ? 'Sandbox sender. No real X account is used.'
          : 'Connected. Replies to people who messaged first go out from this account.'

  return (
    <section aria-label="X account" className="max-w-xl">
      <h3 className="text-xl font-bold">X account</h3>
      <p className="mt-1 text-sm text-muted">The account xdm-scout sends from. It can only send replies to people who messaged it first. Everyone else you message yourself with Open in X.</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-rule bg-paper px-5 py-4">
        <div className="flex items-center gap-3">
          <XLogo className="size-5" />
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted">{note}</p>
          </div>
        </div>
        {s?.mode === 'live' ? (
          <a className={btnSecondary} href="/api/auth/x/login">
            {s.connected ? 'Reconnect X account' : 'Connect X account'}
          </a>
        ) : (
          s && !s.connected && (
            <button type="button" className={btnSecondary} disabled={useSandbox.isPending} onClick={() => useSandbox.mutate()}>
              Use sandbox account
            </button>
          )
        )}
      </div>
      {status.error && <p className="mt-2 text-xs text-block">Could not read the connection: {status.error.message}</p>}
    </section>
  )
}

export default function Account() {
  return (
    <div className="space-y-12">
      <h2 className="text-[28px] font-semibold leading-tight">Profile</h2>
      <XAccount />
      <SenderProfile />
    </div>
  )
}

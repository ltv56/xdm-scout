import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CheckItem, DeliveredItem, InboxChecks } from '../../api/src/inbox/contract'
import { getJson, postJson } from './api'
import { XLogo } from './icons'
import { btnApprove, btnSecondary, card, chip, tone } from './ui'

const REASON: Record<CheckItem['reason'], string> = {
  sent_by_hand: "You marked this as sent in X. X's API can't see messages in encrypted chats, so check it there.",
  not_confirmed: "X didn't confirm this send. Check the chat in X before anything is sent again.",
}

export default function Inbox({ campaignId }: { campaignId: number }) {
  const checks = useQuery<InboxChecks>({ queryKey: ['inbox-checks', campaignId], queryFn: () => getJson(`/inbox/checks?campaignId=${campaignId}`) })

  if (checks.isLoading) return <p role="status" className="text-sm text-muted">Loading…</p>
  if (checks.error || !checks.data) return <p role="alert" className="text-sm font-medium text-block">{checks.error?.message ?? 'Inbox not available'}</p>
  const { toCheck, delivered } = checks.data

  return (
    <div className="max-w-3xl">
      <h1 className="text-[28px] font-bold leading-tight">Inbox</h1>
      <section aria-labelledby="check-heading" className="mt-8">
        <h2 id="check-heading" className="text-lg font-semibold">
          Check in X
          {toCheck.length > 0 && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 align-middle text-xs font-semibold text-accent-ink">{toCheck.length}</span>}
        </h2>
        {toCheck.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing to check. Every message you sent is accounted for.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {toCheck.map((item) => (
              <CheckCard key={item.attemptId} item={item} campaignId={campaignId} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="delivered-heading" className="mt-10">
        <h2 id="delivered-heading" className="text-lg font-semibold">Delivered</h2>
        {delivered.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No delivered messages yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-rule">
            {delivered.map((d) => (
              <DeliveredRow key={d.attemptId} item={d} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function CheckCard({ item, campaignId }: { item: CheckItem; campaignId: number }) {
  const qc = useQueryClient()
  const confirm = useMutation({
    mutationFn: (outcome: 'sent' | 'not_sent') => postJson(`/send-attempts/${item.attemptId}/confirm`, { outcome }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['inbox-checks', campaignId] }), qc.invalidateQueries({ queryKey: ['review-queue'] })]),
  })
  return (
    <li className={`${card} p-5`} aria-label={`@${item.handle}`}>
      <Person item={item} />
      <p className="mt-2 text-sm">{REASON[item.reason]}</p>
      <blockquote className="mt-3 whitespace-pre-line rounded-xl bg-rail px-4 py-3 text-sm">{item.text}</blockquote>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a href={item.openInX} target="_blank" rel="noreferrer" className={btnApprove}>
          <XLogo className="mr-2 size-4" />
          Open chat with @{item.handle}
        </a>
        <button type="button" className={btnSecondary} disabled={confirm.isPending} onClick={() => confirm.mutate('sent')}>
          It was sent
        </button>
        <button type="button" className={btnSecondary} disabled={confirm.isPending} onClick={() => confirm.mutate('not_sent')}>
          It was not sent
        </button>
      </div>
      {confirm.error && (
        <p role="alert" className="mt-2 text-sm font-medium text-block">
          {confirm.error.message}
        </p>
      )}
    </li>
  )
}

function DeliveredRow({ item }: { item: DeliveredItem }) {
  const byApi = item.verifiedBy === 'api'
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
      <Person item={item} />
      <span className={`${chip} ${byApi ? tone.ok.chip : tone.done.chip}`} title={byApi ? 'X returned this message through its API' : 'You checked the chat in X'}>
        {byApi ? 'Seen by X API' : 'Confirmed by you'}
      </span>
    </li>
  )
}

function Person({ item }: { item: CheckItem | DeliveredItem }) {
  return (
    <p className="text-sm">
      <span className="font-semibold">{item.name ?? `@${item.handle}`}</span> <span className="text-muted">@{item.handle} · {when(item.at)}</span>
    </p>
  )
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

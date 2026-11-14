import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CheckItem, DeliveredItem, InboxChecks, ReplyItem } from '../../api/src/inbox/contract'
import { ENDS_CONTACT, REPLY_CLASSES, type ClassBy, type ReplyClass } from '../../api/src/inbox/reply-class'
import { getJson, postJson } from './api'
import { XLogo } from './icons'
import { btnApprove, btnSecondary, btnToolbar, card, chip, money, tone, type Tone } from './ui'

const REASON: Record<CheckItem['reason'], string> = {
  sent_by_hand: "You marked this as sent in X. X's API can't see messages in encrypted chats, so check it there.",
  not_confirmed: "X didn't confirm this send. Check the chat in X before anything is sent again.",
}

const CLASS_TONE: Record<ReplyClass, Tone> = {
  Interested: 'ok',
  Question: 'warn',
  'Not now': 'done',
  'Not interested': 'stop',
  'Opt-out': 'stop',
  Unclear: 'done',
}

const CLASS_BY: Record<ClassBy, string> = { rule: 'They asked to stop', llm: 'Sorted automatically', operator: 'Set by you' }

export default function Inbox({ campaignId }: { campaignId: number }) {
  const checks = useQuery<InboxChecks>({ queryKey: ['inbox-checks', campaignId], queryFn: () => getJson(`/inbox/checks?campaignId=${campaignId}`) })

  if (checks.isLoading) return <p role="status" className="text-sm text-muted">Loading…</p>
  if (checks.error || !checks.data) return <p role="alert" className="text-sm font-medium text-block">{checks.error?.message ?? 'Inbox not available'}</p>
  const { replies, toCheck, delivered } = checks.data
  const open = replies.filter((r) => !r.handled).length

  return (
    <div className="max-w-3xl">
      <h1 className="text-[28px] font-bold leading-tight">Inbox</h1>
      <section aria-labelledby="replies-heading" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="replies-heading" className="text-lg font-semibold">
            Replies
            {open > 0 && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 align-middle text-xs font-semibold text-accent-ink">{open}</span>}
          </h2>
          <CheckNow campaignId={campaignId} />
        </div>
        {replies.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No replies yet. The app checks each chat for 3 days after a send.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {replies.map((r) => (
              <ReplyCard key={r.replyId} item={r} campaignId={campaignId} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="check-heading" className="mt-10">
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
          <>
            <p className="mt-1 text-sm text-muted">Replies in encrypted chats don't reach the app. If someone answered in X, mark it here.</p>
            <ul className="mt-3 divide-y divide-rule">
              {delivered.map((d) => (
                <DeliveredRow key={d.attemptId} item={d} campaignId={campaignId} />
              ))}
            </ul>
          </>
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

function ReplyCard({ item, campaignId }: { item: ReplyItem; campaignId: number }) {
  const qc = useQueryClient()
  const handled = useMutation({
    mutationFn: () => postJson(`/replies/${item.replyId}/handled`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox-checks', campaignId] }),
  })
  const setClass = useMutation({
    mutationFn: (replyClass: ReplyClass) => postJson(`/replies/${item.replyId}/class`, { replyClass }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox-checks', campaignId] }),
  })
  return (
    <li className={`${card} p-5 ${item.handled ? 'opacity-60' : ''}`} aria-label={`Reply from @${item.handle}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Person item={item} />
        <span className="flex flex-wrap items-center gap-2">
          {item.replyClass && (
            <span className={`${chip} ${tone[CLASS_TONE[item.replyClass]].chip}`} title={item.classBy ? CLASS_BY[item.classBy] : undefined}>
              {item.replyClass}
            </span>
          )}
          {item.doNotContact && <span className={`${chip} ${tone.stop.chip}`}>Do not contact</span>}
          {item.handled && <span className={`${chip} ${tone.done.chip}`}>Handled</span>}
        </span>
      </div>
      {item.theirText === null ? (
        <p className="mt-3 text-sm">They replied in an encrypted chat. Read it in X.</p>
      ) : (
        <blockquote className="mt-3 whitespace-pre-line rounded-xl border border-rule px-4 py-3 text-sm">{item.theirText}</blockquote>
      )}
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">You wrote</p>
      <blockquote className="mt-1 whitespace-pre-line rounded-xl bg-rail px-4 py-3 text-sm">{item.ourText}</blockquote>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a href={item.openInX} target="_blank" rel="noreferrer" className={btnApprove}>
          <XLogo className="mr-2 size-4" />
          Open conversation in X
        </a>
        {!item.handled && (
          <button type="button" className={btnSecondary} disabled={handled.isPending} onClick={() => handled.mutate()}>
            Mark handled
          </button>
        )}
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          Class
          <select
            className="rounded-lg border border-rule bg-raised px-2 py-1.5 text-sm text-ink"
            value={item.replyClass ?? ''}
            disabled={setClass.isPending}
            onChange={(e) => setClass.mutate(e.target.value as ReplyClass)}
          >
            {item.replyClass === null && <option value="">Not sorted</option>}
            {REPLY_CLASSES.map((c) => (
              <option key={c} value={c}>
                {ENDS_CONTACT.includes(c) ? `${c} (Do not contact)` : c}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(handled.error ?? setClass.error) && (
        <p role="alert" className="mt-2 text-sm font-medium text-block">
          {(handled.error ?? setClass.error)?.message}
        </p>
      )}
    </li>
  )
}

function CheckNow({ campaignId }: { campaignId: number }) {
  const qc = useQueryClient()
  const check = useMutation({
    mutationFn: () => postJson<{ queued: number; estimatedMicros: number }>(`/inbox/check-now?campaignId=${campaignId}`, {}),
    // The worker reads the chats in the background; refresh once it has had time to.
    onSuccess: () => setTimeout(() => void qc.invalidateQueries({ queryKey: ['inbox-checks', campaignId] }), 5000),
  })
  const result = check.data
  return (
    <span className="flex items-center gap-3">
      {result && (
        <span role="status" className="text-sm text-muted">
          {result.queued === 0 ? 'No chats to check' : `Checking ${result.queued} ${result.queued === 1 ? 'chat' : 'chats'}, estimated ${money(result.estimatedMicros)}`}
        </span>
      )}
      {check.error && (
        <span role="alert" className="text-sm font-medium text-block">
          {check.error.message}
        </span>
      )}
      <button type="button" className={btnToolbar} disabled={check.isPending} onClick={() => check.mutate()} title="Each chat read costs about $0.01">
        Check now
      </button>
    </span>
  )
}

function DeliveredRow({ item, campaignId }: { item: DeliveredItem; campaignId: number }) {
  const qc = useQueryClient()
  const replied = useMutation({
    mutationFn: () => postJson(`/send-attempts/${item.attemptId}/replied`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inbox-checks', campaignId] }),
  })
  const byApi = item.verifiedBy === 'api'
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3">
      <Person item={item} />
      <span className="flex flex-wrap items-center gap-2">
        {item.replied ? (
          <span className={`${chip} ${tone.ok.chip}`}>Replied</span>
        ) : (
          <button type="button" className={btnToolbar} disabled={replied.isPending} onClick={() => replied.mutate()}>
            They replied
          </button>
        )}
        <span className={`${chip} ${byApi ? tone.ok.chip : tone.done.chip}`} title={byApi ? 'X returned this message through its API' : 'You checked the chat in X'}>
          {byApi ? 'Seen by X API' : 'Confirmed by you'}
        </span>
      </span>
      {replied.error && (
        <p role="alert" className="w-full text-sm font-medium text-block">
          {replied.error.message}
        </p>
      )}
    </li>
  )
}

function Person({ item }: { item: { name: string | null; handle: string; at: string } }) {
  return (
    <p className="text-sm">
      <span className="font-semibold">{item.name ?? `@${item.handle}`}</span> <span className="text-muted">@{item.handle} · {when(item.at)}</span>
    </p>
  )
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

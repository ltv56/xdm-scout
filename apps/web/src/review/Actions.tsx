import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { ReviewItem, SkipReason } from '../../../api/src/review/contract'
import { patchJson, postJson } from '../api'
import { Check, Copy, Globe, Pencil, Refresh, XLogo } from '../icons'
import { btnLink, btnSecondary, btnToolbar, btnApprove, field, tone } from '../ui'
import MoreMenu from './MoreMenu'
import { blockers, LANGUAGE_NAME, SKIP_LABEL, SKIP_REASONS, verdict, type Verdict } from './labels'

type Panel = 'none' | 'edit' | 'regenerate' | 'skip'

function useDraftMutations(item: ReviewItem, onFinished: () => void) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['review-queue'] })
  const base = `/drafts/${item.draftId}`
  return {
    approve: useMutation({
      mutationFn: (confirmedUnbacked: boolean) => postJson(`${base}/approve`, { contentHash: item.contentHash, confirmedUnbacked }),
      onSuccess: refresh,
    }),
    edit: useMutation({ mutationFn: (text: string) => patchJson(`${base}`, { text }), onSuccess: refresh }),
    regenerate: useMutation({ mutationFn: (note: string) => postJson(`${base}/regenerate`, { note }), onSuccess: refresh }),
    language: useMutation({ mutationFn: (language: string) => postJson(`${base}/language`, { language }), onSuccess: refresh }),
    skip: useMutation({
      mutationFn: (v: { reason: SkipReason; note: string }) => postJson(`${base}/skip`, { reason: v.reason, ...(v.note && { note: v.note }) }),
      onSuccess: () => refresh().then(onFinished),
    }),
    dnc: useMutation({ mutationFn: () => postJson(`${base}/dnc`), onSuccess: () => refresh().then(onFinished) }),
    manual: useMutation({
      mutationFn: (outcome: 'sent' | 'not_sent') => postJson(`${base}/manual`, { outcome }),
      onSuccess: () => refresh().then(onFinished),
    }),
  }
}

function ErrorLine({ error }: { error: Error | null }) {
  return error ? (
    <p role="alert" className="mt-2 text-sm font-medium text-block">
      {error.message}
    </p>
  ) : null
}

// A modal question, so the choice is made away from the draft and the page behind cannot be used meanwhile.
function DncDialog({ handle, busy, error, onConfirm, onCancel }: { handle: string; busy: boolean; error: Error | null; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  return (
    <dialog
      ref={ref}
      aria-labelledby="dnc-title"
      onClose={onCancel}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className="m-auto w-[min(440px,calc(100vw-3rem))] rounded-2xl border-0 bg-raised p-6 text-ink shadow-pop backdrop:bg-black/30"
    >
      <h3 id="dnc-title" className="text-lg font-semibold">
        Never contact @{handle}?
      </h3>
      <p className="mt-2 text-sm text-muted">Their drafts leave the queue and they stay out of future campaigns.</p>
      <ErrorLine error={error} />
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" autoFocus className={btnSecondary} onClick={() => ref.current?.close()}>
          Cancel
        </button>
        <button type="button" className="rounded-lg bg-block px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60" disabled={busy} onClick={onConfirm}>
          Do not contact
        </button>
      </div>
    </dialog>
  )
}

export interface FrameApi {
  verdict: Verdict
  // True while the message is being edited: the body shows the form instead of the draft text.
  editing: boolean
  // Edit and Regenerate act on the draft text, so the body renders them right under it.
  tools: React.ReactNode
}

// The review panel's chrome: toolbar (draft navigation, Skip, Approve), a notice row with the reasons, an
// area for skip, the scrolling body, and for a hand-sent message a bar pinned at the bottom with Open in X. Edit and Regenerate live with the draft text.
export default function ReviewFrame({ item, nav, onFinished, children }: {
  item: ReviewItem
  nav: React.ReactNode
  onFinished: () => void
  children: (api: FrameApi) => React.ReactNode
}) {
  const m = useDraftMutations(item, onFinished)
  const [panel, setPanel] = useState<Panel>('none')
  const [confirmed, setConfirmed] = useState(false)
  const [text, setText] = useState(item.text)
  const [note, setNote] = useState('')
  const [reason, setReason] = useState<SkipReason>('not_fit')
  const [copied, setCopied] = useState(false)
  // True once they copied the text or opened X: the next question is whether they sent it.
  const [asked, setAsked] = useState(false)
  const [confirmDnc, setConfirmDnc] = useState(false)
  const firstField = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)

  const v = verdict(item)
  const pending = item.status === 'pending'
  const needsConfirm = item.checks.some((c) => c.needsConfirm)
  const blocking = blockers(item.checks)
  const canApprove = blocking.length === 0 && (!needsConfirm || confirmed) && panel === 'none'

  useEffect(() => {
    if (panel === 'edit' || panel === 'regenerate') firstField.current?.focus()
  }, [panel])

  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? 'none' : p))
  const handoff = item.status === 'approved'
  // Offered when they mostly write in another language, and also to go back once the draft has been translated.
  const main = item.prospect.mainLanguage
  const other = main && main !== 'en' ? main : item.language !== 'en' ? item.language : null

  const copyText = () =>
    navigator.clipboard.writeText(item.text).then(() => {
      setCopied(true)
      if (handoff) setAsked(true)
    })
  const bar = `${btnToolbar} inline-flex items-center gap-1.5`

  const tools = (
    <div className="mt-3 empty:hidden">
      {(panel === 'edit' || panel === 'regenerate') && <div className="max-w-[58ch]">
          {panel === 'edit' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                m.edit.mutate(text)
              }}
            >
              <label htmlFor="edit-text" className="text-sm font-semibold">
                Edit the message
              </label>
              <textarea
                id="edit-text"
                ref={(el) => {
                  firstField.current = el
                }}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                className={`${field} mt-1 text-[17px] leading-relaxed`}
              />
              <p className="mt-1 text-sm text-muted">{text.length} characters. Sentences you add are marked as yours and you confirm them before approving. Save or cancel to approve.</p>
              <div className="mt-2 flex items-center gap-3">
                <button type="submit" className={btnApprove} disabled={m.edit.isPending || !text.trim() || text === item.text}>
                  Save changes
                </button>
                <button type="button" className={btnLink} onClick={() => setPanel('none')}>
                  Cancel
                </button>
              </div>
              <ErrorLine error={m.edit.error} />
            </form>
          )}

          {panel === 'regenerate' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                m.regenerate.mutate(note)
              }}
            >
              <label htmlFor="regen-note" className="text-sm font-semibold">
                What should change in this draft?
              </label>
              <input
                id="regen-note"
                ref={(el) => {
                  firstField.current = el
                }}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Shorter, mention the release, drop the second question"
                className={`${field} mt-1`}
              />
              <div className="mt-2 flex items-center gap-3">
                <button type="submit" className={btnApprove} disabled={m.regenerate.isPending || !note.trim()}>
                  Regenerate
                </button>
                <button type="button" className={btnLink} onClick={() => setPanel('none')}>
                  Cancel
                </button>
              </div>
              <ErrorLine error={m.regenerate.error} />
            </form>
          )}

      </div>}
      {panel !== 'edit' && panel !== 'regenerate' && (pending || handoff) && (
        <div className="mt-1 flex flex-wrap items-center gap-x-1">
          <button type="button" className={bar} onClick={copyText}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          {pending && (
            <>
              <button type="button" className={bar} onClick={() => toggle('edit')}>
                <Pencil className="size-4" />
                Edit
              </button>
              <button type="button" className={bar} onClick={() => toggle('regenerate')}>
                <Refresh className="size-4" />
                Regenerate
              </button>
              {other && (
                <button
                  type="button"
                  className={bar}
                  disabled={item.editedByReviewer || m.language.isPending}
                  title={item.editedByReviewer ? 'You edited this draft. Regenerate it first, because a new language replaces the text.' : undefined}
                  onClick={() => m.language.mutate(item.language === 'en' ? other : 'en')}
                >
                  <Globe className="size-4" />
                  {item.language === 'en' ? `Draft in ${LANGUAGE_NAME[other]}` : 'Back to English'}
                </button>
              )}
            </>
          )}
        </div>
      )}
      <ErrorLine error={m.language.error} />
    </div>
  )

  const handle = item.prospect.handle
  // A reply the app may send gets both ways. Sending from here needs a connected X account, which the app cannot do yet.
  const byApp = item.sendPath === 'API_SEND'
  const xBtn = 'inline-flex items-center gap-2'
  const send =
    !(pending || handoff) ? null : (
      <div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <p className="text-sm font-semibold">{byApp ? 'Send it' : 'Send it in X'}</p>
          {byApp && (
            <button type="button" className={btnSecondary} disabled title="Connect your X account in Account first">
              Send from xdm-scout
            </button>
          )}
          {handoff && item.openInXUrl ? (
            <a className={`${btnApprove} ${xBtn}`} href={item.openInXUrl} target="_blank" rel="noreferrer" onClick={() => setAsked(true)}>
              <XLogo className="size-4" />
              Open chat with @{handle} on X
            </a>
          ) : (
            <button type="button" className={`${btnSecondary} ${xBtn}`} disabled>
              <XLogo className="size-4" />
              Open chat with @{handle} on X
            </button>
          )}
          {!handoff && <span className="text-sm text-muted">Available after you approve.</span>}
          {handoff && byApp && !asked && <span className="text-sm text-muted">Connect your X account in Account to send from here.</span>}
          {handoff && asked && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:ml-auto">
              <p className="text-sm font-semibold">Did you send it to @{handle}?</p>
              <button type="button" className={btnApprove} disabled={m.manual.isPending} onClick={() => m.manual.mutate('sent')}>
                Yes
              </button>
              <button type="button" className={btnSecondary} disabled={m.manual.isPending} onClick={() => m.manual.mutate('not_sent')}>
                No
              </button>
            </div>
          )}
        </div>
        <ErrorLine error={m.manual.error} />
      </div>
    )

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-rule px-5 py-3 min-h-[62px] sm:px-8">
        {nav}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
          {pending && (
            <>
              <MoreMenu handle={item.prospect.handle} onDoNotContact={() => setConfirmDnc(true)} />
              <button type="button" className={btnToolbar} onClick={() => toggle('skip')} aria-expanded={panel === 'skip'}>
                Skip
              </button>
              <button type="button" className={`${btnApprove} ml-2`} disabled={!canApprove || m.approve.isPending} onClick={() => m.approve.mutate(confirmed)}>
                Approve
              </button>
            </>
          )}
        </div>
      </div>

      {pending && v.points.length > 0 && (
        <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3 text-sm sm:px-8 ${tone[v.tone].chip}`}>
          <ul className="flex flex-wrap gap-x-6 gap-y-0.5">
            {v.points.map((pt) => (
              <li key={pt} className="before:mr-2 before:content-['•']">
                {pt}
              </li>
            ))}
          </ul>
          {needsConfirm && blocking.length === 0 && (
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" className="size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I wrote it myself and it is true
            </label>
          )}
        </div>
      )}
      <div className="px-5 empty:hidden sm:px-8">
        <ErrorLine error={m.approve.error} />
      </div>

      {panel === 'skip' && (
        <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-rule bg-paper px-5 py-6 sm:px-8">
          {panel === 'skip' && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                m.skip.mutate({ reason, note })
              }}
            >
              <fieldset>
                <legend className="text-sm font-semibold">Why skip this one?</legend>
                <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                  {SKIP_REASONS.map((r) => (
                    <label key={r} className="flex items-center gap-1.5 text-sm">
                      <input type="radio" name="skip-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                      {SKIP_LABEL[r]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <input aria-label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={`${field} mt-2`} />
              <div className="mt-2 flex items-center gap-3">
                <button type="submit" className={btnSecondary} disabled={m.skip.isPending}>
                  Skip draft
                </button>
                <button type="button" className={btnLink} onClick={() => setPanel('none')}>
                  Cancel
                </button>
              </div>
              <ErrorLine error={m.skip.error} />
            </form>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">{children({ verdict: v, editing: panel === 'edit', tools })}</div>
      {send && <div className="shrink-0 border-t border-rule bg-raised px-5 py-3 sm:px-8">{send}</div>}
      {confirmDnc && <DncDialog handle={item.prospect.handle} busy={m.dnc.isPending} error={m.dnc.error} onConfirm={() => m.dnc.mutate()} onCancel={() => setConfirmDnc(false)} />}
    </div>
  )
}

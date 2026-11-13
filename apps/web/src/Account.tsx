import SenderProfile from './SenderProfile'
import { XLogo } from './icons'
import { btnSecondary } from './ui'

// Static for now: nothing here reads the connection yet. Connecting goes through /api/auth/x/login (docs/testing.md);
// a status call and a button that starts it are still to build.
function XAccount() {
  return (
    <section aria-label="X account" className="max-w-xl">
      <h3 className="text-xl font-bold">X account</h3>
      <p className="mt-1 text-sm text-muted">The account xdm-scout sends from. It can only send replies to people who messaged it first. Everyone else you message yourself with Open in X.</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-rule bg-paper px-5 py-4">
        <div className="flex items-center gap-3">
          <XLogo className="size-5" />
          <div>
            <p className="text-sm font-semibold">Not connected</p>
            <p className="text-xs text-muted">Sending replies from here is switched off.</p>
          </div>
        </div>
        <button type="button" className={btnSecondary} disabled title="Not built into the app yet">
          Connect X account
        </button>
      </div>
    </section>
  )
}

export default function Account() {
  return (
    <div className="space-y-12">
      <h2 className="text-[28px] font-semibold leading-tight">Account</h2>
      <XAccount />
      <SenderProfile />
    </div>
  )
}

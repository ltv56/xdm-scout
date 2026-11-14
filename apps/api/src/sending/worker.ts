import { Injectable } from '@nestjs/common'
import { DiscoveryService } from '../discovery/discovery.service'
import { FitService } from '../fit/fit.service'
import { RepliesService } from '../inbox/replies.service'
import { JobsService } from '../jobs/jobs.service'
import { DraftService } from '../review/draft.service'
import { XRateLimitError } from '../x/x-client'
import { SendingService } from './sending.service'

@Injectable()
export class Worker {
  constructor(
    private readonly jobs: JobsService,
    private readonly sending: SendingService,
    private readonly discovery: DiscoveryService,
    private readonly fit: FitService,
    private readonly drafts: DraftService,
    private readonly replies: RepliesService,
  ) {}

  async tick(now = new Date()): Promise<boolean> {
    const job = await this.jobs.claimNext(now)
    if (!job) return false
    try {
      if (job.type === 'send') await this.sending.processAttempt(job.payload.attemptId, now)
      else if (job.type === 'reconcile') await this.sending.reconcile(job.payload.attemptId, now)
      else if (job.type === 'discover') await this.discovery.run(job.payload.campaignId, now)
      else if (job.type === 'score') await this.fit.score(job.payload.prospectId, now)
      else if (job.type === 'verify_manual') await this.sending.verifyManual(job.payload.attemptId)
      else if (job.type === 'draft') await this.drafts.generate(job.payload.prospectId, now)
      else if (job.type === 'read_replies') await this.replies.read(job.payload.contactId, now)
      else throw new Error(`Unknown job type: ${job.type}`)
      await this.jobs.finish(job.id)
    } catch (err) {
      if (err instanceof XRateLimitError) await this.jobs.retry(job.id, err.retryAt)
      else await this.jobs.finish(job.id, err instanceof Error ? err.message : String(err))
    }
    return true
  }

  // One worker runs at a time, so anything still `running` at start was cut off by a crash.
  async recover(now: Date) {
    await this.sending.recoverStale(now)
    await this.jobs.requeueRunning()
  }

  async run(pollMs = 2000) {
    await this.recover(new Date())
    for (;;) {
      const worked = await this.tick()
      if (!worked) await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }
}

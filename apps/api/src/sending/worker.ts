import { Injectable } from '@nestjs/common'
import { DiscoveryService } from '../discovery/discovery.service'
import { JobsService } from '../jobs/jobs.service'
import { SendingService } from './sending.service'

@Injectable()
export class Worker {
  constructor(
    private readonly jobs: JobsService,
    private readonly sending: SendingService,
    private readonly discovery: DiscoveryService,
  ) {}

  async tick(now = new Date()): Promise<boolean> {
    const job = await this.jobs.claimNext(now)
    if (!job) return false
    try {
      if (job.type === 'send') await this.sending.processAttempt(job.payload.attemptId, now)
      else if (job.type === 'reconcile') await this.sending.reconcile(job.payload.attemptId, now)
      else if (job.type === 'discover') await this.discovery.run(job.payload.campaignId, now)
      await this.jobs.finish(job.id)
    } catch (err) {
      await this.jobs.finish(job.id, err instanceof Error ? err.message : String(err))
    }
    return true
  }

  async run(pollMs = 2000) {
    await this.sending.recoverStale(new Date())
    for (;;) {
      const worked = await this.tick()
      if (!worked) await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }
}

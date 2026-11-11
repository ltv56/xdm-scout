import { Injectable } from '@nestjs/common'
import { DataSource, EntityManager } from 'typeorm'
import { Job } from './job.entity'

@Injectable()
export class JobsService {
  constructor(private readonly ds: DataSource) {}

  async enqueue(type: string, payload: Job['payload'], runAt: Date, em: EntityManager = this.ds.manager) {
    await em.save(Job, { type, payload, runAt })
  }

  claimNext(now: Date): Promise<Job | null> {
    return this.ds.transaction(async (em) => {
      const job = await em
        .createQueryBuilder(Job, 'j')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where("j.status = 'pending' AND j.runAt <= :now", { now })
        .orderBy('j.runAt')
        .addOrderBy('j.id')
        .limit(1)
        .getOne()
      if (!job) return null
      await em.update(Job, job.id, { status: 'running' })
      return job
    })
  }

  async finish(id: number, error?: string) {
    await this.ds.getRepository(Job).update(id, error ? { status: 'failed', error } : { status: 'done' })
  }
}

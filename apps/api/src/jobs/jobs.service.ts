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

  hasOpen(type: string, key: string, value: number) {
    return this.ds
      .getRepository(Job)
      .createQueryBuilder('j')
      .where("j.type = :type AND j.status IN ('pending', 'running')", { type })
      .andWhere(`JSON_EXTRACT(j.payload, :path) = :value`, { path: `$.${key}`, value })
      .getExists()
  }

  async retry(id: number, runAt: Date) {
    await this.ds.getRepository(Job).update(id, { status: 'pending', runAt })
  }

  async requeueRunning() {
    await this.ds.getRepository(Job).update({ status: 'running' }, { status: 'pending' })
  }

  async finish(id: number, error?: string) {
    await this.ds.getRepository(Job).update(id, error ? { status: 'failed', error } : { status: 'done' })
  }
}

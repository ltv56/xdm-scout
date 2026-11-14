import { config } from 'dotenv'
import { DataSource } from 'typeorm'
import { Contact, DoNotContact, Draft, SendAttempt, SenderAccount, XUser } from './sending/entities'
import { ApiUsage, Campaign, Prospect, XPost } from './discovery/entities'
import { Claim, Evidence } from './fit/entities'
import { Job } from './jobs/job.entity'
import { ReviewSignal } from './review/review-signal.entity'
import { Setting } from './setting.entity'

config({ path: '../../.env', quiet: true })

export const dataSourceOptions = {
  type: 'mysql' as const,
  url: process.env.DATABASE_URL,
  // MySQL fills createdAt/updatedAt in UTC; read and write every datetime as UTC too, whatever the machine's zone.
  timezone: 'Z',
  entities: [Setting, SenderAccount, XUser, Contact, Draft, SendAttempt, DoNotContact, Job, Campaign, Prospect, XPost, ApiUsage, Evidence, Claim, ReviewSignal],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
}

export default new DataSource(dataSourceOptions)

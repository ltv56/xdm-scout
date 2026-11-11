import { config } from 'dotenv'
import { DataSource } from 'typeorm'
import { Contact, DoNotContact, Draft, SendAttempt, SenderAccount, XUser } from './sending/entities'
import { Campaign, Prospect } from './discovery/entities'
import { Job } from './jobs/job.entity'
import { Setting } from './setting.entity'

config({ path: '../../.env', quiet: true })

export const dataSourceOptions = {
  type: 'mysql' as const,
  url: process.env.DATABASE_URL,
  entities: [Setting, SenderAccount, XUser, Contact, Draft, SendAttempt, DoNotContact, Job, Campaign, Prospect],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
}

export default new DataSource(dataSourceOptions)

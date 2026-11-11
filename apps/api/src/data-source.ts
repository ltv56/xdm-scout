import { config } from 'dotenv'
import { DataSource } from 'typeorm'
import { Setting } from './setting.entity'

config({ path: '../../.env', quiet: true })

export const dataSourceOptions = {
  type: 'mysql' as const,
  url: process.env.DATABASE_URL,
  entities: [Setting],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  synchronize: false,
}

export default new DataSource(dataSourceOptions)

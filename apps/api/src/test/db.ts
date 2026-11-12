import { DataSource } from 'typeorm'
import { dataSourceOptions } from '../data-source'
import { assertTestDatabase } from './test-db-url'

export { assertTestDatabase, testDatabaseUrl } from './test-db-url'

let current: DataSource | undefined

// Schema comes from the entities; migrations are exercised by `db:migrate` in CI.
export async function createTestDataSource(): Promise<DataSource> {
  assertTestDatabase(process.env.DATABASE_URL ?? '')
  if (current?.isInitialized) await current.destroy()
  current = new DataSource({ ...dataSourceOptions, migrations: [], synchronize: true, dropSchema: true })
  return current.initialize()
}

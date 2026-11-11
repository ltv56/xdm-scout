import { DataSource } from 'typeorm'
import { dataSourceOptions } from '../data-source'

// Schema comes from the entities; migrations are exercised by `db:migrate` in CI.
export async function createTestDataSource(): Promise<DataSource> {
  const ds = new DataSource({ ...dataSourceOptions, migrations: [], synchronize: true, dropSchema: true })
  return ds.initialize()
}

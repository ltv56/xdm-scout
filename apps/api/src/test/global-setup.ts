import { config } from 'dotenv'
import { createConnection } from 'mysql2/promise'
import { testDatabaseUrl } from './test-db-url'

config({ path: '../../.env', quiet: true })

export default async function setup() {
  const url = new URL(testDatabaseUrl(process.env.DATABASE_URL ?? ''))
  const name = url.pathname.slice(1)
  url.pathname = ''
  const conn = await createConnection(url.toString())
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name}\``)
  await conn.end()
}

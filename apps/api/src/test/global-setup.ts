import { config } from 'dotenv'
import { createConnection } from 'mysql2/promise'

config({ path: '../../.env', quiet: true })

// Tests run on a separate schema so dropSchema never touches dev data.
export default async function setup() {
  const url = new URL((process.env.DATABASE_URL ?? '').replace(/\/xdm(\?|$)/, '/xdm_test$1'))
  const name = url.pathname.slice(1)
  url.pathname = ''
  const conn = await createConnection(url.toString())
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name}\``)
  await conn.end()
}

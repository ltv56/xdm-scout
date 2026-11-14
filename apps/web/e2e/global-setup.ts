import { createConnection } from 'mysql2/promise'

export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'mysql://xdm:xdm@127.0.0.1:3306/xdm_e2e'

// Empties every table before a run; the API keeps running because the tables stay.
export default async function emptyDatabase() {
  const name = new URL(E2E_DATABASE_URL).pathname.slice(1)
  if (!name.endsWith('_e2e')) throw new Error(`Refusing to empty "${name}": the e2e database name must end in _e2e`)
  const db = await createConnection(E2E_DATABASE_URL)
  try {
    const [rows] = await db.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? AND table_name <> ?', [name, 'migrations'])
    await db.query('SET FOREIGN_KEY_CHECKS = 0')
    for (const { t } of rows as { t: string }[]) await db.query(`TRUNCATE TABLE \`${t}\``)
    await db.query('SET FOREIGN_KEY_CHECKS = 1')
  } finally {
    await db.end()
  }
}

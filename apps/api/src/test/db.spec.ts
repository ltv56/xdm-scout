import { describe, expect, it } from 'vitest'
import { assertTestDatabase, createTestDataSource, testDatabaseUrl } from './db'

describe('test database', () => {
  it('points tests at <name>_test whatever the configured database is called', () => {
    expect(testDatabaseUrl('mysql://u:p@127.0.0.1:3306/xdm?allowPublicKeyRetrieval=true')).toBe(
      'mysql://u:p@127.0.0.1:3306/xdm_test?allowPublicKeyRetrieval=true',
    )
    expect(testDatabaseUrl('mysql://u:p@db:3306/outreach')).toBe('mysql://u:p@db:3306/outreach_test')
    expect(testDatabaseUrl('mysql://u:p@db:3306/xdm_test')).toBe('mysql://u:p@db:3306/xdm_test')
  })

  it('refuses to drop a schema whose name does not end in _test', () => {
    expect(() => assertTestDatabase('mysql://u:p@db:3306/xdm')).toThrow('_test')
    expect(() => assertTestDatabase('mysql://u:p@db:3306/xdm_test')).not.toThrow()
  })

  it('closes the previous connection pool when a new test data source is made', async () => {
    const first = await createTestDataSource()
    const second = await createTestDataSource()
    expect(first.isInitialized).toBe(false)
    expect(second.isInitialized).toBe(true)
    await second.destroy()
  })
})

// Tests drop the schema, so they only ever run on <database>_test.
export function testDatabaseUrl(url: string) {
  const parsed = new URL(url)
  const name = parsed.pathname.slice(1)
  if (!name.endsWith('_test')) parsed.pathname = `/${name}_test`
  return parsed.toString()
}

export function assertTestDatabase(url: string) {
  const name = new URL(url).pathname.slice(1)
  if (!name.endsWith('_test')) throw new Error(`Refusing to drop schema "${name}": test databases must end in _test`)
}

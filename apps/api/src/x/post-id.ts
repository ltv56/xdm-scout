// X post ids are snowflakes: the bits above the lowest 22 are milliseconds since X's epoch (4 Nov 2010).
const X_EPOCH_MS = 1288834974657n

export function postedAtFromId(id: string): Date | null {
  if (!/^\d{1,20}$/.test(id)) return null
  const ms = BigInt(id) >> 22n
  // Ids from before snowflakes are small counters with no time in them.
  if (ms === 0n) return null
  return new Date(Number(ms + X_EPOCH_MS))
}

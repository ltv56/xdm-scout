// The opening line of a first message is made here, not by the model: a name read from X is a fact, and the
// model could use it to pretend we know the person.

const MAX_WORDS = 4
const MAX_LENGTH = 28
const NAME_WORD = /^\p{L}[\p{L}\p{M}'’.-]*$/u
// Words that mean the display name is an organisation, a topic or a bot rather than a person.
const NOT_A_PERSON = new Set(['team', 'official', 'inc', 'ltd', 'llc', 'labs', 'lab', 'hq', 'studio', 'studios', 'ai', 'news', 'daily', 'bot', 'fund', 'capital', 'ventures', 'club', 'group', 'company', 'co', 'tech', 'the'])

// Where a display name usually stops being the name and turns into a tagline.
const TAGLINE = /\s[|/•·–—-]\s|[([{,@]/u

export function usableName(displayName: string | null | undefined): string | null {
  if (!displayName || /\d/.test(displayName)) return null
  const head = displayName.split(TAGLINE)[0] ?? ''
  const cleaned = head
    .replace(/[^\p{L}\p{M}\s'’.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned || cleaned.length > MAX_LENGTH) return null
  const words = cleaned.split(' ')
  if (words.length > MAX_WORDS) return null
  if (!words.every((w) => NAME_WORD.test(w))) return null
  if (words.some((w) => NOT_A_PERSON.has(w.toLowerCase().replace(/\./g, '')))) return null
  // All capitals is a brand or shouting, not a name to greet.
  if (cleaned.length > 3 && cleaned === cleaned.toUpperCase()) return null
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
}

const NAMED = [
  (n: string) => `Hi ${n}!`,
  (n: string) => `Hello ${n}!`,
  (n: string) => `Hey ${n}!`,
  (n: string) => `Hi ${n}, hope your week is going well.`,
  (n: string) => `Hello ${n}, hope you are doing well.`,
  (n: string) => `Hi there ${n}!`,
]

const NAMELESS = ['Hi!', 'Hello!', 'Hey there!', 'Hi there!', 'Hello there!']

// Small stable hash, so one person gets the same opener on every render but different people do not all get the same one.
function hash(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function greetingFor(displayName: string | null | undefined, seed: string): string {
  const name = usableName(displayName)
  const h = hash(seed)
  return name ? NAMED[h % NAMED.length](name) : NAMELESS[h % NAMELESS.length]
}

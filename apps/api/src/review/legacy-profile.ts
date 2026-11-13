// Rows written before programs existed: offers (strings) become programs, source field 'offers' becomes 'program'.
type Json = Record<string, unknown>

export function upgradeProfile(value: Json): Json {
  if (!Array.isArray(value.offers)) return value
  const { offers, ...rest } = value
  const programs = (offers as string[]).map((name, i) => ({ id: i + 1, name, description: name, link: 'https://genaifund.ai/', deadline: null }))
  return { ...rest, programs }
}

type Sentence = { text: string; source: Json | null }

export function upgradeSentences(sentences: Sentence[]): Sentence[] {
  return sentences.map((s) => (s.source?.type === 'sender_profile' && s.source.field === 'offers' ? { ...s, source: { ...s.source, field: 'program' } } : s))
}

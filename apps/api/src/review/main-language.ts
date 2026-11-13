import { Language } from './contract'

const CODES: Record<string, Language> = { en: 'en', vi: 'vi', th: 'th', in: 'id' }

// The language most of a person's posts are in, from the `lang` X gives each post. Needs two detected posts and more than half of them.
export function mainLanguage(posts: { lang: string | null }[]): Language | null {
  const detected = posts.map((p) => p.lang).filter((l): l is string => !!l && l !== 'und')
  if (detected.length < 2) return null
  const counts = new Map<Language, number>()
  for (const l of detected) {
    const code = CODES[l]
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  const [top] = [...counts].sort((a, b) => b[1] - a[1])
  return top && top[1] / detected.length > 0.5 ? top[0] : null
}

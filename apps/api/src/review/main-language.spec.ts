import { describe, expect, it } from 'vitest'
import { mainLanguage } from './main-language'

const posts = (...langs: (string | null)[]) => langs.map((lang) => ({ lang }))

describe('mainLanguage', () => {
  it('is the language most of the detected posts are in', () => {
    expect(mainLanguage(posts('vi', 'vi', 'en', 'vi'))).toBe('vi')
    expect(mainLanguage(posts('en', 'en', 'en'))).toBe('en')
  })

  it('maps X\'s code for Indonesian', () => {
    expect(mainLanguage(posts('in', 'in', 'en'))).toBe('id')
  })

  it('ignores posts with no detected language and languages we do not write in', () => {
    expect(mainLanguage(posts('und', null, 'th', 'th', 'th', 'fr'))).toBe('th')
  })

  it('is null when we cannot tell: too few posts, no majority, or only other languages', () => {
    expect(mainLanguage(posts('vi'))).toBeNull()
    expect(mainLanguage(posts('vi', 'en'))).toBeNull()
    expect(mainLanguage(posts('fr', 'fr', 'de'))).toBeNull()
    expect(mainLanguage([])).toBeNull()
  })
})

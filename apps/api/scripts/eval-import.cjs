// Turn answers copied from a chat app into a cache file the other eval scripts read.
//   node scripts/eval-import.cjs <name> <answers.json>...
// An answers file is a JSON array like [{"id":"dm001","invitation":0.9},{"id":"dr001","no_sensitive":0.9,"one_person":0.8}].
const { askKey, cachePath, fs, loadCache, loadItems, outDir } = require('./eval-common.cjs')

const [name, ...files] = process.argv.slice(2)
if (!name || !files.length) {
  console.error('usage: node scripts/eval-import.cjs <name> <answers.json>...')
  process.exit(2)
}
const byIdAndCode = new Map(loadItems().map((i) => [`${i.id}|${i.code}`, i]))
const cache = loadCache(name)
let added = 0
let skipped = 0
let perSentence = 0
for (const file of files) {
  for (const { id, ...codes } of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    for (const [code, p] of Object.entries(codes)) {
      const item = byIdAndCode.get(`${id}|${code}`)
      if (item && item.asks.length > 1) perSentence++
      else if (item && typeof p === 'number') {
        cache[askKey(item.asks[0])] = p
        added++
      } else skipped++
    }
  }
}
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(cachePath(name), JSON.stringify(cache))
console.log(`${name}: ${added} answers stored, ${skipped} skipped (unknown id or question), ${perSentence} skipped (asked per sentence, one answer per draft does not fit)`)

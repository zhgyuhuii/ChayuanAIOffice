const ts = require('typescript')
const fs = require('fs')
const sf = ts.createSourceFile('s.ts', fs.readFileSync('apps/pdf/src/renderer/i18n/strings.ts','utf8'), ts.ScriptTarget.Latest, true)
// strings 对象
let stringsObj = null, localizedObj = null
sf.forEachChild((n) => {
  if (ts.isVariableStatement(n)) {
    const d = n.declarationList.declarations[0]
    const name = d.name.getText(sf)
    let init = d.initializer
    if (ts.isAsExpression(init)) init = init.expression
    if (name === 'strings') stringsObj = init
    if (name === 'localizedFillFormStrings') localizedObj = init
  }
})
function langsOf(obj, sf) {
  const out = {}
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p)) {
      const lang = p.name.getText(sf)
      if (!out[lang]) out[lang] = new Set()
      for (const m of p.initializer.properties) { if (ts.isPropertyAssignment(m)) out[lang].add(m.name.getText(sf)) }
    }
  }
  return out
}
const sLangs = langsOf(stringsObj, sf)
const lLangs = localizedObj ? langsOf(localizedObj, sf) : {}
const zh = sLangs['zh']
for (const [lang, keys] of Object.entries(sLangs)) {
  const miss = [...zh].filter((k) => !keys.has(k))
  const extra = [...keys].filter((k) => !zh.has(k))
  if (miss.length || extra.length) console.log('strings.' + lang, 'missing', miss.length, miss.slice(0,5), 'extra', extra.length, extra.slice(0,5))
}
for (const [lang, keys] of Object.entries(lLangs)) {
  const miss = [...zh].filter((k) => !keys.has(k))
  const extra = [...keys].filter((k) => !zh.has(k))
  if (miss.length || extra.length) console.log('localized.' + lang, 'missing', miss.length, miss.slice(0,5), 'extra', extra.length, extra.slice(0,5))
}
console.log('strings.zh keys:', zh.size)

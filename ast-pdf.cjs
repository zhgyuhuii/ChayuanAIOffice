const ts = require('typescript')
const fs = require('fs')
const sec = /^  '?([a-z]{2}(?:-[A-Za-z]+)?)'?: \{$/
const keyline = /^    ([A-Za-z][A-Za-z0-9]*):(?: |$)/
function clean(t){return t.replace(/^\s*\n/, '').replace(/\s*$/, '') + ','}
function extractStrings(path) {
  const sf = ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  let obj = null, sfOut = sf
  sf.forEachChild((n) => {
    if (ts.isVariableStatement(n)) {
      const d = n.declarationList.declarations[0]
      if (d && d.name.getText(sf) === 'strings') {
        let init = d.initializer
        if (ts.isAsExpression(init)) init = init.expression
        obj = init; sfOut = sf
      }
    }
  })
  if (!obj) throw new Error('no strings in ' + path)
  return { obj, sf: sfOut }
}
function membersOf(obj, sf) {
  const out = []
  obj.properties.forEach((p) => { if (ts.isPropertyAssignment(p)) out.push({ name: p.name.getText(sf), node: p, sf }) })
  return out
}
const prist = extractStrings('/tmp/pdf-up.ts')
const base = extractStrings('/tmp/pdf-base.ts')
const pLangs = membersOf(prist.obj, prist.sf).filter((m) => ts.isObjectLiteralExpression(m.node.initializer))
const bLangs = membersOf(base.obj, base.sf).filter((m) => ts.isObjectLiteralExpression(m.node.initializer))
const bLangMap = {}
for (const bl of bLangs) bLangMap[bl.name] = bl
const sectionsText = []
let baseOnlyTotal = 0
for (const pl of pLangs) {
  const bl = bLangMap[pl.name]
  const bMembers = bl ? membersOf(bl.node.initializer, bl.sf) : []
  const bMap = {}
  for (const bm of bMembers) bMap[bm.name] = bm
  const seen = new Set()
  const lines = [(pl.name === 'zh-TW' ? "  'zh-TW'" : '  ' + pl.name) + ': {']
  for (const pm of membersOf(pl.node.initializer, pl.sf)) {
    seen.add(pm.name)
    const src = bMap[pm.name] || pm
    lines.push(clean(src.node.getFullText(src.sf)))
  }
  for (const bm of bMembers) {
    if (!seen.has(bm.name)) { lines.push(clean(bm.node.getFullText(bm.sf))); baseOnlyTotal++ }
  }
  lines.push('  },')
  sectionsText.push(lines.join('\n'))
}
for (const bl of bLangs) {
  if (pLangs.some((pl) => pl.name === bl.name)) continue
  const lines = [(bl.name === 'zh-TW' ? "  'zh-TW'" : '  ' + bl.name) + ': {']
  for (const bm of membersOf(bl.node.initializer, bl.sf)) lines.push(clean(bm.node.getFullText(bm.sf)))
  lines.push('  },')
  sectionsText.push(lines.join('\n'))
  baseOnlyTotal += membersOf(bl.node.initializer, bl.sf).length
}
fs.writeFileSync('/tmp/pdf-strings-merged.ts', [
  '/**',
  ' * strings 总表（生成）：上游节序(09485f8) ∪ 本地键；同键值取本地(310596b0+编辑)。',
  ' */',
  'export const strings = {',
  ...sectionsText,
  '} as const',
  '',
].join('\n'))
console.log('pdf merged; baseOnly:', baseOnlyTotal)

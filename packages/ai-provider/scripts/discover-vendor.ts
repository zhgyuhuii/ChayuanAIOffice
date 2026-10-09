/**
 * CLI: vendor contract discovery. Given a base URL (key via env), runs the
 * fingerprint → docs → probe pipeline and prints / writes the profile JSON.
 *
 *   DISCOVERY_API_KEY=sk-... npx tsx scripts/discover-vendor.ts \
 *     https://api.agnes-ai.cn/v1 [profile.json]
 *
 * Add --full to keep polling the probe job to a terminal state (verifies the
 * result-field path; adds minutes of runtime). --no-video / --no-image skip
 * those probes (a skipped probe costs nothing on paid vendors).
 */
import { writeFileSync } from 'node:fs'
import { discoverVendorContract } from '../src/vendor-discovery'

const args = process.argv.slice(2)
const full = args.includes('--full')
const noVideo = args.includes('--no-video')
const noImage = args.includes('--no-image')
const positional = args.filter((a) => !a.startsWith('--'))
const [url, out] = positional as [string | undefined, string | undefined]
const key = process.env.DISCOVERY_API_KEY

if (!url || !key) {
  console.error(
    'usage: DISCOVERY_API_KEY=... npx tsx scripts/discover-vendor.ts https://host/v1 [profile.json] [--full] [--no-video] [--no-image]',
  )
  process.exit(1)
}

const profile = await discoverVendorContract(url, key, {
  fullVerify: full,
  ...(noVideo ? { probeVideo: false } : {}),
  ...(noImage ? { probeImage: false } : {}),
})

const json = JSON.stringify(profile, null, 2)
if (out) {
  writeFileSync(out, json)
  console.error(`profile written to ${out}`)
} else {
  console.log(json)
}

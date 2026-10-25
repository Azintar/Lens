import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import YAML from 'js-yaml'
import { venueAdapters, type VenueAdapter } from '../src/ingest/venues'
import { isInternalRoute } from '../src/openapi/coverage'

const readmePath = fileURLToPath(new URL('../README.md', import.meta.url))
const openApiPath = fileURLToPath(new URL('../openapi.yaml', import.meta.url))

export const VENUES_START_TAG = '<!-- VENUES:START -->'
export const VENUES_END_TAG = '<!-- VENUES:END -->'

export const ENDPOINTS_START_TAG = '<!-- ENDPOINTS:START -->'
export const ENDPOINTS_END_TAG = '<!-- ENDPOINTS:END -->'

export interface EndpointDocEntry {
  method: string
  path: string
  description: string
}

/**
 * Metadata for rendering endpoints in the README.
 * Keyed by `${METHOD} ${openApiPath}`.
 */
export const ENDPOINT_METADATA: Record<string, { displayPath?: string; description?: string }> = {
  'GET /price/{assetA}/{assetB}': {
    displayPath: '/price/:assetA/:assetB',
    description: 'Current VWAP, 24h volume, best route',
  },
  'GET /price/{assetA}/{assetB}/route': {
    displayPath: '/price/:assetA/:assetB/route?amount=1000',
    description: 'Best execution route for a given amount',
  },
  'GET /price/{assetA}/{assetB}/depth': {
    displayPath: '/price/:assetA/:assetB/depth?amount=1000',
    description: 'Simulated order-book depth and execution slippage',
  },
  'GET /book/{assetA}/{assetB}': {
    displayPath: '/book/:assetA/:assetB?depth=0.1&step=0.01&network=testnet',
    description: 'Aggregated SDEX book and synthetic AMM price ladder with cumulative size and venue provenance',
  },
  'GET /price/{assetA}/{assetB}/history': {
    displayPath: '/price/:assetA/:assetB/history?window=1h',
    description: 'OHLCV history (`1m`, `5m`, `1h`, `24h`)',
  },
  'GET /price/twap/{assetA}/{assetB}': {
    displayPath: '/price/twap/:assetA/:assetB?window=60&sampleInterval=60&method=iqr',
    description: 'Manipulation-resistant time-weighted average price',
  },
  'GET /price/vwap/{assetA}/{assetB}': {
    displayPath: '/price/vwap/:assetA/:assetB?window=60&source=SDEX&method=iqr',
    description: 'Volume-weighted average price',
  },
  'GET /candles/{assetA}/{assetB}': {
    displayPath: '/candles/:assetA/:assetB?interval=1h&from=…&to=…',
    description: 'OHLCV candles (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`)',
  },
  'GET /prices/history': {
    displayPath: '/prices/history?pair=XLM/USDC&from=…&to=…&interval=1m',
    description: 'Historical 1-minute price snapshots, optionally aggregated (`1m`, `5m`, `1h`); honours `?network=`; `?format=csv` serves the points as `text/csv` (`ts,price,volume`); ~30-day retention',
  },
  'GET /pools': {
    displayPath: '/pools',
    description: 'Active AMM pools being watched',
  },
  'GET /pairs': {
    displayPath: '/pairs',
    description: 'Watched trading pairs',
  },
  'POST /pairs': {
    displayPath: '/pairs',
    description: 'Add a new trading pair (Admin only)',
  },
  'GET /volumes/{asset}': {
    displayPath: '/volumes/:asset?window=24h&network=testnet',
    description: 'Cross-venue volume and trade-size concentration (`24h`, `7d`, `30d`) with per-venue breakdown',
  },
  'GET /impact/{assetA}/{assetB}': {
    displayPath: '/impact/:assetA/:assetB?thresholds=1,5,10',
    description: 'Adaptive slippage ladder and threshold crossing sizes',
  },
  'GET /snapshot': {
    // One network, not `testnet|mainnet`: a raw pipe ends the markdown table
    // cell, and an escaped one reads worse than just picking an example.
    displayPath: '/snapshot?network=testnet',
    description: 'Whole-network snapshot: venues, TVL, 24h volume, top pairs, peg readings and data freshness in one cached, timestamped object',
  },
  'GET /live': {
    displayPath: '/live',
    description: 'Liveness probe — no dependency checks (see [`docs/health.md`](docs/health.md))',
  },
  'GET /ready': {
    displayPath: '/ready',
    description: 'Readiness probe — boot complete + dependencies reachable',
  },
  'GET /usage/me': {
    displayPath: '/usage/me',
    description: 'Usage and quota for the calling API key (requires `Authorization: Bearer <key>`)',
  },
  'GET/POST /graphql': {
    displayPath: '/graphql',
    description: 'GraphQL query/mutation endpoint (GraphiQL IDE at `/graphiql`, docs: [`docs/graphql.md`](docs/graphql.md))',
  },
  'GET /spreads/{asset}': {
    displayPath: '/spreads/:asset?window=5m',
    description: 'Per-venue bid/ask spread, tightest first (`5m`, `15m`, `1h`, `24h`)',
  },
  'GET /compare/{asset}': {
    displayPath: '/compare/:asset',
    description: 'Lens vs configured oracle prices, with per-oracle deviation and availability',
  },
  'GET /screener': {
    displayPath: '/screener?sortBy=volume&order=desc&limit=20',
    description: 'Screen pairs by volume, 24h change, liquidity and price',
  },
  'GET /benchmark/{asset}': {
    displayPath: '/benchmark/:asset?target=USD',
    description: 'Peg-deviation statistics versus a target',
  },
  'GET /basket': {
    displayPath: '/basket?asset=XLM&asset=USDC&weight=0.6&weight=0.4',
    description: 'Weighted price of a basket of assets',
  },
  'GET /status': {
    displayPath: '/status',
    description: 'Indexer health',
  },
  'GET /discovery/resources': {
    displayPath: '/discovery/resources?type=&payTo=&network=&extensions=&limit=&offset=',
    description: 'Bazaar catalog of x402-discoverable resources (spec: [`bazaar`](https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md))',
  },
  'GET /usage/me': {
    displayPath: '/usage/me',
    description: 'Usage and quota for the calling API key (requires `Authorization: Bearer <key>`)',
  },
  'GET /supported': {
    displayPath: '/supported',
    description: 'Payment kinds and extensions this facilitator supports',
  },
  'POST /verify': {
    displayPath: '/verify',
    description: 'Verify an x402 payment payload',
  },
  'POST /settle': {
    displayPath: '/settle',
    description: 'Settle an x402 payment (idempotent — retries replay the stored result)',
  },
  'POST /webhooks': {
    displayPath: '/webhooks',
    description: 'Subscribe to a price-threshold webhook',
  },
  'DELETE /webhooks/{id}': {
    displayPath: '/webhooks/:id',
    description: 'Delete a webhook subscription',
  },
  'GET/POST /graphql': {
    displayPath: '/graphql',
    description: 'GraphQL query/mutation endpoint (GraphiQL IDE at `/graphiql`, docs: [`docs/graphql.md`](docs/graphql.md))',
  },
}

/**
 * Extracts content between two delimiter tags from a markdown document.
 */
export function extractSection(content: string, startTag: string, endTag: string): string | null {
  const startIndex = content.indexOf(startTag)
  if (startIndex === -1) return null

  const afterStart = startIndex + startTag.length
  const endIndex = content.indexOf(endTag, afterStart)
  if (endIndex === -1) return null

  return content.slice(afterStart, endIndex)
}

/**
 * Renders the markdown table of venue adapters registered in venueAdapters.
 */
export function renderVenuesTable(adapters: VenueAdapter[] = venueAdapters): string {
  const lines = [
    '| Venue | Source | Type | Description |',
    '|---|---|---|---|',
  ]

  // No fallback for a missing type/description: VenueAdapter requires both, so
  // an adapter that does not describe itself fails to compile rather than
  // producing a row that reads as documented and says nothing.
  for (const adapter of adapters) {
    lines.push(`| ${adapter.name} | \`${adapter.source}\` | ${adapter.type} | ${adapter.description} |`)
  }

  return lines.join('\n')
}

interface OpenApiParameter {
  name: string
  in: string
  required?: boolean
  example?: unknown
  style?: string
  explode?: boolean
  schema?: { type?: string; example?: unknown }
}

interface OpenApiDocument {
  paths: Record<string, Record<string, any>>
  components?: { parameters?: Record<string, OpenApiParameter> }
}

/**
 * Resolves `$ref: '#/components/parameters/…'` entries so shared parameters
 * (e.g. `NetworkQuery`) are judged by their real `required`/`example`.
 * Unresolvable refs are dropped rather than guessed at.
 */
function resolveParameters(spec: OpenApiDocument, parameters: unknown): OpenApiParameter[] {
  if (!Array.isArray(parameters)) return []
  const resolved: OpenApiParameter[] = []
  for (const p of parameters) {
    const ref = (p as { $ref?: unknown })?.$ref
    if (typeof ref === 'string') {
      const match = ref.match(/^#\/components\/parameters\/(.+)$/)
      const target = match ? spec.components?.parameters?.[match[1]] : undefined
      if (target) resolved.push(target)
    } else if (p && typeof p === 'object') {
      resolved.push(p as OpenApiParameter)
    }
  }
  return resolved
}

/**
 * Encodes a query value for the README table, keeping it copy-pasteable and
 * readable: `/`, `,` and `:` stay literal (they are legal in a query string
 * and `pair=XLM/USDC` reads better than `pair=XLM%2FUSDC`), while anything
 * that would break the URL or the markdown cell (`&`, `#`, spaces, `|`) is
 * percent-encoded.
 */
function encodeQueryValue(value: unknown): string {
  return encodeURIComponent(String(value))
    .replace(/%2F/gi, '/')
    .replace(/%2C/gi, ',')
    .replace(/%3A/gi, ':')
}

/**
 * Builds the worked query string for an operation from the `example:` values
 * of its *required* query parameters, e.g. `?pair=XLM/USDC`.
 *
 * Optional parameters are left out on purpose: the table shows the minimum a
 * caller must send, and every optional one has a server-side default. A
 * required parameter with no example is also left out rather than given a
 * placeholder, so the generator never prints a value the spec did not state.
 * Array parameters follow OpenAPI's `form` style, which explodes by default
 * (`asset=XLM&asset=USDC`); `explode: false` joins with commas instead.
 */
export function renderQueryExample(
  pathParameters: OpenApiParameter[] = [],
  operationParameters: OpenApiParameter[] = [],
): string {
  // Operation-level parameters override path-level ones with the same name+in.
  const byKey = new Map<string, OpenApiParameter>()
  for (const p of [...pathParameters, ...operationParameters]) {
    if (p && typeof p === 'object' && 'name' in p) byKey.set(`${p.in}:${p.name}`, p)
  }

  const pairs: string[] = []
  for (const p of byKey.values()) {
    if (p.in !== 'query' || p.required !== true) continue
    const example = p.example ?? p.schema?.example
    if (example === undefined || example === null) continue

    const name = encodeURIComponent(p.name)
    if (Array.isArray(example)) {
      if (example.length === 0) continue
      if (p.explode === false) {
        pairs.push(`${name}=${example.map(encodeQueryValue).join(',')}`)
      } else {
        for (const item of example) pairs.push(`${name}=${encodeQueryValue(item)}`)
      }
    } else {
      pairs.push(`${name}=${encodeQueryValue(example)}`)
    }
  }

  return pairs.length > 0 ? `?${pairs.join('&')}` : ''
}

/**
 * Renders the markdown table of REST endpoints from openapi.yaml.
 */
export function renderEndpointsTable(specYaml?: string): string {
  const source = specYaml ?? readFileSync(openApiPath, 'utf8')
  const spec = YAML.load(source) as OpenApiDocument

  // Ordered list of endpoints to preserve logical categorization
  const rows: EndpointDocEntry[] = []

  // Check /graphql combined GET/POST entry
  const hasGraphql = spec.paths['/graphql'] && (spec.paths['/graphql'].get || spec.paths['/graphql'].post)

  for (const [openApiPathKey, operations] of Object.entries(spec.paths)) {
    if (isInternalRoute(openApiPathKey)) continue
    if (openApiPathKey === '/graphql') continue // rendered as single GET/POST row

    for (const [methodKey, op] of Object.entries(operations)) {
      const method = methodKey.toUpperCase()
      if (!['GET', 'POST', 'DELETE', 'PUT', 'PATCH'].includes(method)) continue

      const key = `${method} ${openApiPathKey}`
      const meta = ENDPOINT_METADATA[key]
      const defaultFastifyPath = openApiPathKey.replace(/{([A-Za-z0-9_]+)}/g, ':$1')
      const queryExample = renderQueryExample(
        resolveParameters(spec, operations.parameters),
        resolveParameters(spec, op.parameters),
      )
      const path = meta?.displayPath ?? `${defaultFastifyPath}${queryExample}`
      const description = meta?.description ?? op.summary ?? op.description ?? ''

      rows.push({ method, path, description })
    }
  }

  if (hasGraphql) {
    const meta = ENDPOINT_METADATA['GET/POST /graphql']
    rows.push({
      method: 'GET/POST',
      path: meta?.displayPath ?? '/graphql',
      description: meta?.description ?? 'GraphQL query/mutation endpoint',
    })
  }

  const lines = [
    '| Method | Path | Description |',
    '|---|---|---|',
  ]

  for (const r of rows) {
    lines.push(`| ${r.method} | \`${r.path}\` | ${r.description} |`)
  }

  return lines.join('\n')
}

/**
 * Replaces the delimited sections of README.md with generated content.
 */
export function renderReadme(content?: string): string {
  let doc = content ?? readFileSync(readmePath, 'utf8')

  // Render Venues
  const venuesContent = `\n${renderVenuesTable()}\n`
  if (doc.includes(VENUES_START_TAG) && doc.includes(VENUES_END_TAG)) {
    const startIdx = doc.indexOf(VENUES_START_TAG) + VENUES_START_TAG.length
    const endIdx = doc.indexOf(VENUES_END_TAG)
    doc = doc.slice(0, startIdx) + venuesContent + doc.slice(endIdx)
  }

  // Render Endpoints
  const endpointsContent = `\n${renderEndpointsTable()}\n`
  if (doc.includes(ENDPOINTS_START_TAG) && doc.includes(ENDPOINTS_END_TAG)) {
    const startIdx = doc.indexOf(ENDPOINTS_START_TAG) + ENDPOINTS_START_TAG.length
    const endIdx = doc.indexOf(ENDPOINTS_END_TAG)
    doc = doc.slice(0, startIdx) + endpointsContent + doc.slice(endIdx)
  }

  return doc
}

/**
 * Regenerates the venues and endpoints sections in README.md.
 */
export function generateReadme(): void {
  writeFileSync(readmePath, renderReadme())
}

/**
 * Compares the committed README.md with a fresh render and reports whether it
 * has drifted. Line endings are normalised first, as in `tests/readme.test.ts`,
 * so a CRLF checkout of an identical table is not reported as drift.
 */
export function readmeIsCurrent(content?: string): boolean {
  const committed = (content ?? readFileSync(readmePath, 'utf8')).replace(/\r\n/g, '\n')
  return renderReadme(committed) === committed
}

// CLI entry point. `--check` (`npm run readme:check`, run in CI) writes
// nothing and exits non-zero when README.md differs from a fresh generation.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    if (!readmeIsCurrent()) {
      console.error(
        'README.md is out of date: its generated tables (endpoints from openapi.yaml, venues from src/ingest/venues) differ from a fresh generation.\n' +
          'Run `npm run openapi:gen` and commit the result.',
      )
      process.exit(1)
    }
    console.log('README.md venue and endpoint tables are up to date')
  } else {
    generateReadme()
    console.log('Successfully generated README.md venues and endpoints sections')
  }
}

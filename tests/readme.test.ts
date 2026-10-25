import { describe, expect, it } from 'vitest'
import { readFileSync as readFileRaw } from 'node:fs'

import { fileURLToPath } from 'node:url'
import YAML from 'js-yaml'
import { venueAdapters } from '../src/ingest/venues'
import {
  extractSection,
  renderVenuesTable,
  renderEndpointsTable,
  renderQueryExample,
  renderReadme,
  readmeIsCurrent,
  VENUES_START_TAG,
  VENUES_END_TAG,
  ENDPOINTS_START_TAG,
  ENDPOINTS_END_TAG,
} from '../scripts/generate-readme'
import { INTERNAL_ROUTES, isInternalRoute } from '../src/openapi/coverage'

/**
 * Read a file with its line endings normalised to LF.
 *
 * The generators join rows with a bare newline, but git hands a Windows
 * checkout CRLF, so a byte comparison against README.md fails on every line
 * of an identical table. .gitattributes pins README.md to LF for the same
 * reason; normalising here as well means a contributor whose git config
 * differs is not blocked by a diff that is only line endings.
 */
function readFileSync(path: string, encoding: 'utf8'): string {
  return readFileRaw(path, encoding).replace(/\r\n/g, String.fromCharCode(10))
}

const readmePath = fileURLToPath(new URL('../README.md', import.meta.url))
const openApiPath = fileURLToPath(new URL('../openapi.yaml', import.meta.url))

describe('README venue list and endpoint table generators', () => {
  it('extracts and asserts that the README venues section matches the venueAdapters registry', () => {
    const readmeContent = readFileSync(readmePath, 'utf8')
    const venuesSection = extractSection(readmeContent, VENUES_START_TAG, VENUES_END_TAG)

    expect(venuesSection, 'README must contain <!-- VENUES:START --> ... <!-- VENUES:END --> tags').toBeTruthy()

    const expectedVenues = renderVenuesTable(venueAdapters)
    expect(venuesSection?.trim()).toBe(expectedVenues.trim())
  })

  it('ensures every venue in venueAdapters is represented in the README', () => {
    const readmeContent = readFileSync(readmePath, 'utf8')
    const venuesSection = extractSection(readmeContent, VENUES_START_TAG, VENUES_END_TAG) ?? ''

    for (const adapter of venueAdapters) {
      expect(venuesSection).toContain(adapter.name)
      expect(venuesSection).toContain(`\`${adapter.source}\``)
    }

    // Must include newly added venues that were previously missing: Soroswap and Aquarius
    expect(venuesSection).toContain('Soroswap')
    expect(venuesSection).toContain('`soroswap_amm`')
    expect(venuesSection).toContain('Aquarius')
    expect(venuesSection).toContain('`aquarius_amm`')
  })

  it('fails when the README and venue registry diverge', () => {
    const fakeAdapters = [
      ...venueAdapters,
      {
        name: 'NewDex',
        source: 'new_dex',
        type: 'Order Book',
        description: 'New decentralized exchange',
        isEnabled: () => true,
        getPollIntervalMs: () => 5000,
        discover: async () => [],
        read: async () => null,
        derive: () => [],
        write: async () => {},
        ingestPair: async () => {},
      },
    ]

    const expectedWithFake = renderVenuesTable(fakeAdapters)
    const readmeContent = readFileSync(readmePath, 'utf8')
    const currentVenues = extractSection(readmeContent, VENUES_START_TAG, VENUES_END_TAG) ?? ''

    // The test must detect when a new venue is in registry but missing from README
    expect(currentVenues.trim()).not.toBe(expectedWithFake.trim())
  })

  it('extracts and asserts that the README endpoints table matches openapi.yaml routes', () => {
    const readmeContent = readFileSync(readmePath, 'utf8')
    const endpointsSection = extractSection(readmeContent, ENDPOINTS_START_TAG, ENDPOINTS_END_TAG)

    expect(endpointsSection, 'README must contain <!-- ENDPOINTS:START --> ... <!-- ENDPOINTS:END --> tags').toBeTruthy()

    const expectedEndpoints = renderEndpointsTable()
    expect(endpointsSection?.trim()).toBe(expectedEndpoints.trim())
  })

  it('ensures every public non-internal route in openapi.yaml is present in the endpoint table', () => {
    const spec = YAML.load(readFileSync(openApiPath, 'utf8')) as { paths: Record<string, Record<string, any>> }
    const readmeContent = readFileSync(readmePath, 'utf8')
    const endpointsSection = extractSection(readmeContent, ENDPOINTS_START_TAG, ENDPOINTS_END_TAG) ?? ''

    for (const [path, operations] of Object.entries(spec.paths)) {
      if (isInternalRoute(path)) continue

      for (const method of Object.keys(operations)) {
        if (['get', 'post', 'delete', 'put', 'patch'].includes(method.toLowerCase())) {
          // Path in README may use Fastify :param style or openapi {param} style
          const fastifyPath = path.replace(/{([A-Za-z0-9_]+)}/g, ':$1')
          const hasPath = endpointsSection.includes(path) || endpointsSection.includes(fastifyPath)
          expect(
            hasPath,
            `Expected ${method.toUpperCase()} ${path} (or ${fastifyPath}) to be documented in README endpoint table`
          ).toBe(true)
        }
      }
    }
  })

  it('fails when README and openapi routes diverge', () => {
    const readmeContent = readFileSync(readmePath, 'utf8')
    const currentEndpoints = extractSection(readmeContent, ENDPOINTS_START_TAG, ENDPOINTS_END_TAG) ?? ''

    // If an unregistered fake route is expected, it must diverge
    expect(currentEndpoints).not.toContain('/fake/nonexistent/endpoint')
  })

  it('readme:check passes on the committed README and fails once the endpoint table is edited by hand', () => {
    const committed = readFileSync(readmePath, 'utf8')
    expect(readmeIsCurrent(committed)).toBe(true)

    // The documented paths carry the /v1 prefix since 97c50bf. The assertion
    // below is what keeps this honest: a replace that matched nothing would
    // leave `edited` identical and the drift check would pass vacuously.
    const edited = committed.replace('| GET | `/v1/tvl` |', '| GET | `/v1/tvl-renamed` |')
    expect(edited).not.toBe(committed)
    expect(readmeIsCurrent(edited)).toBe(false)
  })

  it('renders README deterministically in-place', () => {
    const initial = readFileSync(readmePath, 'utf8')
    const rendered = renderReadme(initial)
    const reRendered = renderReadme(rendered)
    expect(rendered).toBe(reRendered)
  })
})

describe('README endpoint table query-string examples', () => {
  const spec = `
openapi: 3.0.3
info: { title: t, version: '1' }
components:
  parameters:
    NetworkQuery:
      name: network
      in: query
      required: false
      schema: { type: string, default: testnet }
    RequiredRef:
      name: pair
      in: query
      required: true
      example: XLM/USDC
      schema: { type: string }
paths:
  /v1/needs-pair:
    get:
      summary: Required param with an example
      parameters:
        - name: pair
          in: query
          required: true
          example: XLM/USDC
          schema: { type: string }
        - name: interval
          in: query
          required: false
          example: 5m
          schema: { type: string, default: 1m }
        - $ref: '#/components/parameters/NetworkQuery'
  /v1/via-ref:
    get:
      summary: Required param through a $ref
      parameters:
        - $ref: '#/components/parameters/RequiredRef'
  /v1/array/{asset}:
    get:
      summary: Exploded array plus schema-level example
      parameters:
        - name: asset
          in: path
          required: true
          example: XLM
          schema: { type: string }
        - name: asset
          in: query
          required: true
          style: form
          explode: true
          example: [XLM, USDC]
          schema: { type: array, items: { type: string } }
        - name: ids
          in: query
          required: true
          explode: false
          schema: { type: array, items: { type: integer }, example: [1, 2] }
  /v1/no-example:
    get:
      summary: Required param without an example
      parameters:
        - name: query
          in: query
          required: true
          schema: { type: string }
`

  it('appends example values for required query parameters only', () => {
    const table = renderEndpointsTable(spec)
    expect(table).toContain('| GET | `/v1/needs-pair?pair=XLM/USDC` |')
    // optional params (even with an example) and the optional NetworkQuery ref stay out
    expect(table).not.toContain('interval=')
    expect(table).not.toContain('network=')
  })

  it('resolves $ref parameters before deciding whether they are required', () => {
    expect(renderEndpointsTable(spec)).toContain('| GET | `/v1/via-ref?pair=XLM/USDC` |')
  })

  it('explodes array examples by default, joins them when explode is false, and ignores path params', () => {
    expect(renderEndpointsTable(spec)).toContain('| GET | `/v1/array/:asset?asset=XLM&asset=USDC&ids=1,2` |')
  })

  it('leaves a required parameter without an example out instead of inventing a value', () => {
    expect(renderEndpointsTable(spec)).toContain('| GET | `/v1/no-example` |')
  })

  it('percent-encodes characters that would break the URL or the markdown cell', () => {
    const qs = renderQueryExample([], [
      { name: 'q', in: 'query', required: true, example: 'a b|c&d#e' },
    ])
    expect(qs).toBe('?q=a%20b%7Cc%26d%23e')
  })

  it('the committed README carries worked query strings for routes with required query params', () => {
    const readmeContent = readFileSync(readmePath, 'utf8')
    const endpointsSection = extractSection(readmeContent, ENDPOINTS_START_TAG, ENDPOINTS_END_TAG) ?? ''
    const rowsWithQuery = endpointsSection.split('\n').filter((l) => /^\| (GET|POST) \| `[^`]*\?/.test(l))
    expect(rowsWithQuery.length).toBeGreaterThan(0)
    expect(endpointsSection).toContain('`/v1/basket?asset=XLM&asset=USDC&weight=0.6&weight=0.4`')
  })
})

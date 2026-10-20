import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import YAML from 'js-yaml'

const sourcePath = fileURLToPath(new URL('../openapi.yaml', import.meta.url))
const destinationPath = fileURLToPath(new URL('../openapi.json', import.meta.url))
const readmePath = fileURLToPath(new URL('../README.md', import.meta.url))

/** Markers around the generated endpoint table in README.md. */
export const README_TABLE_START = '<!-- BEGIN GENERATED ENDPOINT TABLE -->'
export const README_TABLE_END = '<!-- END GENERATED ENDPOINT TABLE -->'

/** HTTP methods that may appear as operations under an OpenAPI path item. */
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const

interface Operation {
  summary?: string
  description?: string
}

interface SpecDocument {
  paths?: Record<string, Record<string, unknown>>
}

/**
 * Renders the committed `openapi.json` from `openapi.yaml`.
 *
 * Exported (rather than inlined in the CLI) so `tests/openapi.test.ts` can
 * assert that the committed JSON is exactly what the generator produces — the
 * spec is auto-published from openapi.json on every push, so a stale committed
 * file is a broken public contract even though the source YAML looks right.
 *
 * Deterministic by construction: `js-yaml` preserves document key order and
 * `JSON.stringify` is stable for a fixed object, so the same YAML always yields
 * byte-identical output. The test runs it twice to guarantee that.
 */
export function renderOpenApiJson(yamlSource?: string): string {
  const source = yamlSource ?? readFileSync(sourcePath, 'utf8')
  const document = YAML.load(source)
  return JSON.stringify(document, null, 2) + '\n'
}

function escapeCell(value: string): string {
  // `|` would split the markdown cell; newlines would end the row.
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()
}

/**
 * Renders the REST endpoint table from `openapi.yaml`.
 *
 * One row per operation, in the order the spec declares them. Paths use the
 * OpenAPI `{param}` form — the spec is the source of truth for this table, and
 * it cannot encode the example query strings the hand-written table used. The
 * description is the operation's `summary`, falling back to `description`.
 */
export function renderEndpointTable(yamlSource?: string): string {
  const source = yamlSource ?? readFileSync(sourcePath, 'utf8')
  const document = (YAML.load(source) ?? {}) as SpecDocument

  const rows = ['| Method | Path | Description |', '|---|---|---|']
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as Operation | undefined
      if (!operation || typeof operation !== 'object') continue
      const description = operation.summary ?? operation.description ?? ''
      rows.push(`| ${method.toUpperCase()} | \`${path}\` | ${escapeCell(description)} |`)
    }
  }

  return rows.join('\n')
}

/**
 * Returns the table currently committed between the README markers.
 *
 * Throws when either marker is missing or reversed, so a mangled README fails
 * the generator loudly instead of silently appending a second table.
 */
export function extractEndpointTable(readmeSource: string): string {
  const start = readmeSource.indexOf(README_TABLE_START)
  const end = readmeSource.indexOf(README_TABLE_END)
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `README.md is missing the generated endpoint table markers (${README_TABLE_START} … ${README_TABLE_END})`,
    )
  }
  return readmeSource.slice(start + README_TABLE_START.length, end).trim()
}

/** Replaces the README's generated table with a fresh rendering. */
export function renderReadme(readmeSource: string, yamlSource?: string): string {
  const table = renderEndpointTable(yamlSource)
  extractEndpointTable(readmeSource) // validate the markers before rewriting
  const start = readmeSource.indexOf(README_TABLE_START) + README_TABLE_START.length
  const end = readmeSource.indexOf(README_TABLE_END)
  return `${readmeSource.slice(0, start)}\n${table}\n${readmeSource.slice(end)}`
}

/** Regenerates `openapi.json` and the README endpoint table, in place. */
export function generateOpenApi(): void {
  writeFileSync(destinationPath, renderOpenApiJson())
  const readme = readFileSync(readmePath, 'utf8')
  writeFileSync(readmePath, renderReadme(readme))
}

/**
 * Lists committed artifacts that differ from a fresh generation.
 *
 * Empty means the tree is up to date. Used by `npm run openapi:check` in CI so
 * a hand-edited spec or README fails the build instead of drifting.
 */
export function checkGeneratedArtifacts(): string[] {
  const problems: string[] = []

  if (renderOpenApiJson() !== readFileSync(destinationPath, 'utf8')) {
    problems.push('openapi.json does not match openapi.yaml')
  }

  const readme = readFileSync(readmePath, 'utf8')
  try {
    if (extractEndpointTable(readme) !== renderEndpointTable()) {
      problems.push('README endpoint table does not match openapi.yaml')
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error))
  }

  return problems
}

// Run only when invoked directly (`npm run openapi:gen` / `openapi:check`),
// not when imported by the test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const problems = checkGeneratedArtifacts()
    if (problems.length > 0) {
      console.error(`Generated API artifacts are stale:\n  - ${problems.join('\n  - ')}`)
      console.error('Run `npm run openapi:gen` and commit the result.')
      process.exit(1)
    }
    console.log('openapi.json and the README endpoint table are up to date')
  } else {
    generateOpenApi()
    console.log('Generated openapi.json and the README endpoint table')
  }
}

import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { analyzePixels, decodePng, frameDifference, regionalChange, type PixelFrame } from './pixels'

interface Diagnostics {
  readonly sceneReady: boolean
  readonly renderer: string
  readonly textureDimensions: Readonly<Record<string, readonly [number, number]>>
  readonly simulationTime: number
  readonly bodyPositions: readonly { readonly id: string; readonly x: number; readonly y: number; readonly z: number }[]
  readonly frameCount: number
  readonly qualityTier: string
  readonly interactionState: string
  readonly absorptionState: string
  readonly lastError: string | null
}

const LOCAL_ORIGIN = 'http://127.0.0.1:4173/'
const REQUIRED_TEXTURE_KEYS = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'saturn-rings'] as const
const REQUIRED_TEXTURE_PATHS = REQUIRED_TEXTURE_KEYS.map((key) => `/textures/${key}.webp`)
const EXPECTED_DECODED_TEXTURE_KEYS = [...REQUIRED_TEXTURE_KEYS].sort()
const TRACKED_ORBITAL_BODY_IDS = REQUIRED_TEXTURE_KEYS.filter((key) => key !== 'sun' && key !== 'saturn-rings')
const STAGES = ['tidal', 'collapse', 'fade', 'consumed']
const EVIDENCE_REPORT_PATH = process.env.BRAIN_HANDS_BROWSER_EVIDENCE_REPORT
const EVIDENCE_CHECK_ORDER = ['initial-scene-1280', 'black-hole-1280', 'initial-scene-1920', 'black-hole-1920'] as const
const CONSOLE_ERROR_POLICY = 'no_errors'
const INITIAL_SELECTORS = ['.app-shell', 'canvas[data-testid="webgl-canvas"]', 'header.topbar', '.control-dock'] as const
const BLACK_HOLE_SELECTORS = ['.guide-status.is-hot', 'canvas[data-testid="webgl-canvas"]', '.interaction-state', '.control-dock'] as const

type EvidenceStatus = 'passed' | 'failed' | 'skipped'

interface PixelCheck {
  readonly sampled_pixels: number
  readonly non_blank_pixels: number
  readonly unique_colors: number
}

interface EvidenceReport {
  readonly check_name: string
  url: string
  readonly status: EvidenceStatus
  readonly observed_selectors: readonly string[]
  readonly missing_selectors: readonly string[]
  readonly console_errors: readonly string[]
  readonly expected_network: readonly string[]
  readonly observed_network: readonly string[]
  readonly missing_network: readonly string[]
  readonly screenshot_artifact: string
  readonly console_error_policy: string
  readonly viewport: { readonly width: number; readonly height: number; readonly mobile: false }
  readonly horizontal_overflow: boolean
  readonly overlap_failures: readonly string[]
  readonly final_exact_origin_assertion_passed: boolean
  readonly pixel_check: PixelCheck
  readonly failure_reasons: readonly string[]
  readonly skipped_reason: string | null
}

interface EvidenceBundle {
  readonly generated_at: string
  readonly status: EvidenceStatus
  readonly reports: readonly EvidenceReport[]
}

interface CoordinationState {
  readonly invocation_id: string
  readonly completed_check_names: readonly string[]
  readonly reports: Readonly<Record<string, EvidenceReport>>
}

interface EvidenceDraft {
  readonly checkName: string
  readonly screenshotArtifact: string
  url: string
  readonly viewport: { readonly width: number; readonly height: number; readonly mobile: false }
  readonly expectedSelectors: readonly string[]
  readonly expectedNetwork: readonly string[]
  observedSelectors: string[]
  missingSelectors: string[]
  pixelCheck: PixelCheck
  horizontalOverflow: boolean
  responsiveAssertionCompleted: boolean
  overlapFailures: EvidenceReport['overlap_failures']
  unmatchedExpectedNetwork: string[]
  finalExactOriginAssertionPassed: boolean
  failureReasons: string[]
  skippedReason: string | null
  visualStagePassed: boolean
}

function viewportFor(page: Page): { readonly width: number; readonly height: number; readonly mobile: false } {
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('Playwright did not provide a desktop viewport')
  return { width: viewport.width, height: viewport.height, mobile: false }
}

function checkNameFor(page: Page, state: 'initial' | 'black-hole'): string {
  return `${state === 'initial' ? 'initial-scene' : 'black-hole'}-${viewportFor(page).width}`
}

function overlapFailure(first: string, second: string): string {
  return `${first} overlaps ${second}`
}

function matchesExpectedNetworkPattern(pattern: string, observedUrl: string): boolean {
  if (!/^https?:\/\//.test(observedUrl)) return false
  if (pattern.endsWith('/**')) return observedUrl.startsWith(pattern.slice(0, -2))
  return observedUrl === pattern
}

function unmatchedExpectedNetworkPatterns(expectedNetwork: readonly string[], observedNetwork: readonly string[]): readonly string[] {
  return expectedNetwork.filter((pattern) => !observedNetwork.some((observedUrl) => matchesExpectedNetworkPattern(pattern, observedUrl)))
}

function createEvidenceDraft(page: Page, state: 'initial' | 'black-hole', expectedSelectors: readonly string[], forbiddenOverlaps: readonly (readonly [string, string])[]): EvidenceDraft {
  const viewport = viewportFor(page)
  return {
    checkName: checkNameFor(page, state),
    screenshotArtifact: screenshotName(page, state),
    url: '',
    viewport,
    expectedSelectors,
    expectedNetwork: [LOCAL_ORIGIN, `${LOCAL_ORIGIN}assets/**`, `${LOCAL_ORIGIN}textures/**`],
    observedSelectors: [],
    missingSelectors: [...expectedSelectors],
    horizontalOverflow: false,
    responsiveAssertionCompleted: false,
    overlapFailures: forbiddenOverlaps.map(([first, second]) => overlapFailure(first, second)),
    unmatchedExpectedNetwork: [],
    finalExactOriginAssertionPassed: false,
    pixelCheck: { sampled_pixels: 0, non_blank_pixels: 0, unique_colors: 0 },
    failureReasons: [],
    skippedReason: 'The corresponding browser state did not complete its real interaction gates.',
    visualStagePassed: false
  }
}

function evidenceReport(draft: EvidenceDraft, consoleErrors: readonly string[], allRequests: readonly string[], status: EvidenceStatus, failureReasons: readonly string[], skippedReason: string | null): EvidenceReport {
  const report: EvidenceReport = {
    check_name: draft.checkName,
    url: draft.url,
    status,
    observed_selectors: [...draft.observedSelectors],
    missing_selectors: [...draft.missingSelectors],
    console_errors: [...consoleErrors],
    expected_network: [...draft.expectedNetwork],
    observed_network: allRequests.filter((url) => /^https?:\/\//.test(url)),
    missing_network: [...draft.unmatchedExpectedNetwork],
    screenshot_artifact: draft.screenshotArtifact,
    console_error_policy: CONSOLE_ERROR_POLICY,
    viewport: draft.viewport,
    horizontal_overflow: draft.horizontalOverflow,
    overlap_failures: [...draft.overlapFailures],
    final_exact_origin_assertion_passed: draft.finalExactOriginAssertionPassed,
    failure_reasons: [...failureReasons],
    skipped_reason: skippedReason,
  }
  report.pixel_check = draft.pixelCheck
  return report
}

function hasConcretePixelCheck(value: unknown): value is PixelCheck {
  if (!value || typeof value !== 'object') return false
  const pixelCheck = value as Partial<PixelCheck>
  return ['sampled_pixels', 'non_blank_pixels', 'unique_colors'].every((key) => {
    const metric = pixelCheck[key as keyof PixelCheck]
    return Number.isInteger(metric) && (metric as number) >= 0
  })
}

function normalizePixelCheck(value: unknown): PixelCheck {
  const pixelCheck = value && typeof value === 'object' ? value as Partial<PixelCheck> : {}
  const metric = (key: keyof PixelCheck): number => {
    const value = pixelCheck[key]
    return Number.isInteger(value) && (value as number) >= 0 ? value as number : 0
  }
  return { sampled_pixels: metric('sampled_pixels'), non_blank_pixels: metric('non_blank_pixels'), unique_colors: metric('unique_colors') }
}

function isLocalObservedUrl(value: string): boolean {
  try {
    return /^https?:\/\//.test(value) && new URL(value).origin === LOCAL_ORIGIN.slice(0, -1)
  } catch {
    return false
  }
}

function isValidPassedReport(report: EvidenceReport): boolean {
  const isBlackHole = report.check_name.startsWith('black-hole-')
  const width = report.check_name.endsWith('-1920') ? 1920 : report.check_name.endsWith('-1280') ? 1280 : 0
  const expectedSelectors = isBlackHole ? BLACK_HOLE_SELECTORS : INITIAL_SELECTORS
  const expectedScreenshot = width === 0 ? '' : `artifacts/screenshots/solar-${width}-${isBlackHole ? 'black-hole' : 'initial'}.png`
  const expectedNetwork = [LOCAL_ORIGIN, `${LOCAL_ORIGIN}assets/**`, `${LOCAL_ORIGIN}textures/**`]
  return report.status === 'passed' &&
    EVIDENCE_CHECK_ORDER.includes(report.check_name as typeof EVIDENCE_CHECK_ORDER[number]) &&
    report.url === LOCAL_ORIGIN &&
    report.screenshot_artifact === expectedScreenshot &&
    report.viewport.width === width &&
    report.viewport.height === (width === 1920 ? 1080 : 720) &&
    JSON.stringify(report.expected_network) === JSON.stringify(expectedNetwork) &&
    hasConcretePixelCheck(report.pixel_check) &&
    report.pixel_check.sampled_pixels > 0 &&
    report.pixel_check.non_blank_pixels > 0 &&
    report.pixel_check.unique_colors > 0 &&
    expectedSelectors.every((selector) => report.observed_selectors.includes(selector)) &&
    report.missing_selectors.length === 0 &&
    report.console_errors.length === 0 &&
    report.console_error_policy === CONSOLE_ERROR_POLICY &&
    report.observed_network.length > 0 &&
    report.observed_network.every(isLocalObservedUrl) &&
    report.missing_network.length === 0 &&
    report.viewport.mobile === false &&
    report.horizontal_overflow === false &&
    report.overlap_failures.length === 0 &&
    report.final_exact_origin_assertion_passed === true &&
    report.failure_reasons.length === 0 &&
    report.skipped_reason === null
}

function aggregateStatus(reports: readonly EvidenceReport[], completedCheckNames: readonly string[]): EvidenceStatus {
  if (completedCheckNames.length === EVIDENCE_CHECK_ORDER.length &&
    reports.length === EVIDENCE_CHECK_ORDER.length &&
    EVIDENCE_CHECK_ORDER.every((name) => reports.some((report) => report.check_name === name && isValidPassedReport(report)))) return 'passed'
  if (reports.some((report) => report.status === 'failed')) return 'failed'
  return 'skipped'
}

const COORDINATION_DIRECTORY = join(tmpdir(), 'orbitarium-browser-evidence')
const COORDINATION_KEY = EVIDENCE_REPORT_PATH ? createHash('sha256').update(EVIDENCE_REPORT_PATH).digest('hex') : null
const COORDINATION_STATE_PATH = COORDINATION_KEY ? join(COORDINATION_DIRECTORY, `${COORDINATION_KEY}.json`) : null
const COORDINATION_LOCK_PATH = COORDINATION_KEY ? join(COORDINATION_DIRECTORY, `${COORDINATION_KEY}.lock`) : null
const INVOCATION_ID = process.env.BRAIN_HANDS_BROWSER_EVIDENCE_INVOCATION_ID ?? `playwright-process-${process.pid}`

function skippedPlaceholder(checkName: typeof EVIDENCE_CHECK_ORDER[number]): EvidenceReport {
  const isBlackHole = checkName.startsWith('black-hole')
  const width = checkName.endsWith('1920') ? 1920 : 1280
  return {
    check_name: checkName,
    url: LOCAL_ORIGIN,
    status: 'skipped',
    observed_selectors: [],
    missing_selectors: [...(isBlackHole ? BLACK_HOLE_SELECTORS : INITIAL_SELECTORS)],
    console_errors: [],
    expected_network: [LOCAL_ORIGIN, `${LOCAL_ORIGIN}assets/**`, `${LOCAL_ORIGIN}textures/**`],
    observed_network: [],
    screenshot_artifact: `artifacts/screenshots/solar-${width}-${isBlackHole ? 'black-hole' : 'initial'}.png`,
    console_error_policy: CONSOLE_ERROR_POLICY,
    viewport: { width, height: width === 1920 ? 1080 : 720, mobile: false },
    horizontal_overflow: false,
    overlap_failures: [],
    missing_network: [LOCAL_ORIGIN, `${LOCAL_ORIGIN}assets/**`, `${LOCAL_ORIGIN}textures/**`],
    final_exact_origin_assertion_passed: false,
    pixel_check: { sampled_pixels: 0, non_blank_pixels: 0, unique_colors: 0 },
    failure_reasons: [],
    skipped_reason: 'This check was not reached during the current Playwright invocation.'
  }
}

function initialCoordinationState(): CoordinationState {
  return {
    invocation_id: INVOCATION_ID,
    completed_check_names: [],
    reports: Object.fromEntries(EVIDENCE_CHECK_ORDER.map((name) => [name, skippedPlaceholder(name)]))
  }
}

async function acquireEvidenceLock(): Promise<() => Promise<void>> {
  if (!COORDINATION_LOCK_PATH) throw new Error('Evidence coordination is unavailable')
  await mkdir(COORDINATION_DIRECTORY, { recursive: true })
  const deadline = Date.now() + 15_000
  while (true) {
    try {
      const handle = await open(COORDINATION_LOCK_PATH, 'wx')
      await handle.writeFile(JSON.stringify({ invocation_id: INVOCATION_ID, pid: process.pid }))
      await handle.close()
      return async () => {
        await unlink(COORDINATION_LOCK_PATH).catch(() => undefined)
      }
    } catch (error: unknown) {
      if ((error as { readonly code?: string }).code !== 'EEXIST' || Date.now() >= deadline) throw error
      try {
        const lockOwner = JSON.parse(await readFile(COORDINATION_LOCK_PATH, 'utf8')) as { readonly pid?: number }
        if (typeof lockOwner.pid === 'number') {
          try {
            process.kill(lockOwner.pid, 0)
          } catch (ownerError: unknown) {
            if ((ownerError as { readonly code?: string }).code === 'ESRCH') {
              await unlink(COORDINATION_LOCK_PATH).catch(() => undefined)
              continue
            }
          }
        }
      } catch {
        // The owner may be between creating and populating the lock file.
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}

async function readCoordinationState(): Promise<CoordinationState | null> {
  if (!COORDINATION_STATE_PATH) return null
  try {
    const parsed = JSON.parse(await readFile(COORDINATION_STATE_PATH, 'utf8')) as Partial<CoordinationState>
    if (
      parsed.invocation_id !== INVOCATION_ID ||
      !parsed.reports ||
      !Array.isArray(parsed.completed_check_names) ||
      !EVIDENCE_CHECK_ORDER.every((name) => parsed.reports?.[name]?.check_name === name)
    ) return null
    return parsed as CoordinationState
  } catch {
    return null
  }
}

async function writeEvidenceBundle(reports: readonly EvidenceReport[]): Promise<void> {
  if (!EVIDENCE_REPORT_PATH) return
  if (!isAbsolute(EVIDENCE_REPORT_PATH)) throw new Error('BRAIN_HANDS_BROWSER_EVIDENCE_REPORT must be an absolute path')
  if (!COORDINATION_STATE_PATH || !COORDINATION_LOCK_PATH) throw new Error('Evidence coordination is unavailable')

  const releaseLock = await acquireEvidenceLock()
  let temporaryReportPath: string | undefined
  let temporaryStatePath: string | undefined
  try {
    const current = await readCoordinationState()
    const state = current ?? initialCoordinationState()
    const nextReports = Object.fromEntries(EVIDENCE_CHECK_ORDER.map((name) => [name, {
      ...state.reports[name],
      pixel_check: normalizePixelCheck(state.reports[name]?.pixel_check)
    }])) as Record<string, EvidenceReport>
    const completed = new Set(state.completed_check_names)
    for (const report of reports) {
      if (EVIDENCE_CHECK_ORDER.includes(report.check_name as typeof EVIDENCE_CHECK_ORDER[number])) {
        nextReports[report.check_name] = report
        completed.add(report.check_name)
      }
    }
    const nextState: CoordinationState = {
      invocation_id: INVOCATION_ID,
      completed_check_names: EVIDENCE_CHECK_ORDER.filter((name) => completed.has(name)),
      reports: nextReports
    }
    const orderedReports = EVIDENCE_CHECK_ORDER.map((name) => nextState.reports[name])
    const bundle: EvidenceBundle = {
      generated_at: new Date().toISOString(),
      status: aggregateStatus(orderedReports, nextState.completed_check_names),
      reports: orderedReports
    }
    await mkdir(dirname(EVIDENCE_REPORT_PATH), { recursive: true })
    temporaryReportPath = join(dirname(EVIDENCE_REPORT_PATH), `.${basename(EVIDENCE_REPORT_PATH)}.${process.pid}.tmp`)
    await writeFile(temporaryReportPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
    await rename(temporaryReportPath, EVIDENCE_REPORT_PATH)
    temporaryReportPath = undefined

    temporaryStatePath = `${COORDINATION_STATE_PATH}.tmp`
    await writeFile(temporaryStatePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8')
    await rename(temporaryStatePath, COORDINATION_STATE_PATH)
    temporaryStatePath = undefined
    if (nextState.completed_check_names.length === EVIDENCE_CHECK_ORDER.length) await unlink(COORDINATION_STATE_PATH).catch(() => undefined)
  } finally {
    if (temporaryReportPath) await unlink(temporaryReportPath).catch(() => undefined)
    if (temporaryStatePath) await unlink(temporaryStatePath).catch(() => undefined)
    await releaseLock()
  }
}

async function observeSelectors(page: Page, draft: EvidenceDraft): Promise<void> {
  const observed: string[] = []
  for (const selector of draft.expectedSelectors) {
    if (await page.locator(selector).count() > 0) observed.push(selector)
  }
  draft.observedSelectors = observed
  draft.missingSelectors = draft.expectedSelectors.filter((selector) => !observed.includes(selector))
}

function addFailure(draft: EvidenceDraft, reason: string): void {
  if (!draft.failureReasons.includes(reason)) draft.failureReasons.push(reason)
  draft.skippedReason = null
}
const runningUnderVitest = Boolean(
  import.meta.env?.VITEST ||
  (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }).process?.env?.VITEST_WORKER_ID
)

function diagnostics(page: Page): Promise<Diagnostics | null> {
  return page.evaluate(() => {
    const value = (window as Window & { __orbitariumDiagnostics?: Diagnostics }).__orbitariumDiagnostics
    return value ? { ...value, textureDimensions: { ...value.textureDimensions }, bodyPositions: [...value.bodyPositions] } : null
  })
}

async function waitForReady(page: Page): Promise<Diagnostics> {
  try {
    await page.locator('canvas[data-testid="webgl-canvas"]').waitFor({ state: 'visible' })
    await page.waitForFunction((textureKeys) => {
      const value = (window as Window & { __orbitariumDiagnostics?: Diagnostics }).__orbitariumDiagnostics
      const decodedKeys = value ? Object.keys(value.textureDimensions).sort() : []
      return Boolean(
        value?.sceneReady &&
        value.simulationTime >= 0.75 &&
        value.frameCount >= 4 &&
        value.renderer !== 'pending' &&
        value.renderer !== 'WebGL unavailable' &&
        value.lastError === null &&
        decodedKeys.length === textureKeys.length &&
        decodedKeys.every((key, index) => key === [...textureKeys].sort()[index])
      )
    }, REQUIRED_TEXTURE_KEYS, { timeout: 15_000, polling: 250 })
  } catch (error) {
    const observed = await diagnostics(page)
    throw new Error(`Timed out waiting for scene readiness. Observed diagnostics: ${JSON.stringify(observed)}`, { cause: error })
  }
  const value = await diagnostics(page)
  expect(value).not.toBeNull()
  expect(value?.renderer).not.toBe('pending')
  expect(value?.renderer).not.toBe('WebGL unavailable')
  expect(value?.lastError).toBeNull()
  expect(Object.keys(value?.textureDimensions ?? {}).sort()).toEqual(EXPECTED_DECODED_TEXTURE_KEYS)
  return value as Diagnostics
}

async function attachDiagnostics(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const value = await diagnostics(page)
  await testInfo.attach(name, {
    body: JSON.stringify(value, null, 2),
    contentType: 'application/json'
  })
}

function positionDelta(before: Diagnostics, after: Diagnostics): number {
  const previous = new Map(before.bodyPositions.map((body) => [body.id, body]))
  return Math.max(...after.bodyPositions.map((body) => {
    const prior = previous.get(body.id)
    return prior ? Math.hypot(body.x - prior.x, body.y - prior.y, body.z - prior.z) : 0
  }))
}

function orbitalBodyMovements(before: Diagnostics, after: Diagnostics): readonly { readonly id: string; readonly distance: number }[] {
  const previous = new Map(before.bodyPositions.map((body) => [body.id, body]))
  return TRACKED_ORBITAL_BODY_IDS.flatMap((id) => {
    const prior = previous.get(id)
    const current = after.bodyPositions.find((body) => body.id === id)
    if (!prior || !current) return []
    return [{ id, distance: Math.hypot(current.x - prior.x, current.y - prior.y, current.z - prior.z) }]
  })
}

function projectedBodyMotion(before: Diagnostics, after: Diagnostics, bodyId: string, cursor: { x: number; z: number }): number {
  const previous = before.bodyPositions.find((body) => body.id === bodyId)
  const current = after.bodyPositions.find((body) => body.id === bodyId)
  if (!previous || !current) return 0
  const toCursorX = cursor.x - previous.x
  const toCursorZ = cursor.z - previous.z
  const distance = Math.hypot(toCursorX, toCursorZ)
  if (distance === 0) return 0
  return ((current.x - previous.x) * toCursorX + (current.z - previous.z) * toCursorZ) / distance
}

function projectCursorToOrbitalPlane(hoverX: number, hoverY: number, bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): { readonly x: number; readonly z: number } {
  const camera = { x: 0, y: 4.2, z: 9.6 }
  const cameraDistance = Math.hypot(camera.y, camera.z)
  const forward = { x: 0, y: -camera.y / cameraDistance, z: -camera.z / cameraDistance }
  const right = { x: 1, y: 0, z: 0 }
  const up = { x: 0, y: camera.z / cameraDistance, z: -camera.y / cameraDistance }
  const verticalScale = Math.tan((46 * Math.PI) / 360)
  const aspect = bounds.width / bounds.height
  const normalizedX = ((hoverX - bounds.x) / bounds.width) * 2 - 1
  const normalizedY = 1 - ((hoverY - bounds.y) / bounds.height) * 2
  const ray = {
    x: forward.x + right.x * normalizedX * verticalScale * aspect + up.x * normalizedY * verticalScale,
    y: forward.y + right.y * normalizedX * verticalScale * aspect + up.y * normalizedY * verticalScale,
    z: forward.z + right.z * normalizedX * verticalScale * aspect + up.z * normalizedY * verticalScale
  }
  if (bounds.width <= 0 || bounds.height <= 0 || Math.abs(ray.y) < Number.EPSILON) throw new Error('Cannot project cursor through an invalid canvas bound')
  const distanceToPlane = -camera.y / ray.y
  return { x: camera.x + distanceToPlane * ray.x, z: camera.z + distanceToPlane * ray.z }
}

function projectOrbitalPointToCanvas(point: { readonly x: number; readonly z: number }, bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): { readonly x: number; readonly y: number } {
  const camera = { x: 0, y: 4.2, z: 9.6 }
  const cameraDistance = Math.hypot(camera.y, camera.z)
  const forward = { x: 0, y: -camera.y / cameraDistance, z: -camera.z / cameraDistance }
  const up = { x: 0, y: camera.z / cameraDistance, z: -camera.y / cameraDistance }
  const verticalScale = Math.tan((46 * Math.PI) / 360)
  const relative = { x: point.x - camera.x, y: -camera.y, z: point.z - camera.z }
  const depth = relative.x * forward.x + relative.y * forward.y + relative.z * forward.z
  const normalizedX = (relative.x / depth) / (verticalScale * (bounds.width / bounds.height))
  const normalizedY = ((relative.x * up.x + relative.y * up.y + relative.z * up.z) / depth) / verticalScale
  return {
    x: bounds.x + ((normalizedX + 1) / 2) * bounds.width,
    y: bounds.y + ((1 - normalizedY) / 2) * bounds.height
  }
}

function hoverPerturbationTowardCursor(baselineBefore: Diagnostics, baselineAfter: Diagnostics, hoverBefore: Diagnostics, hoverAfter: Diagnostics, bodyId: string, cursor: { x: number; z: number }): number {
  const baseline = projectedBodyMotion(baselineBefore, baselineAfter, bodyId, cursor)
  const hover = projectedBodyMotion(hoverBefore, hoverAfter, bodyId, cursor)
  return hover - baseline
}

function screenshotName(page: Page, state: 'initial' | 'black-hole'): string {
  return page.viewportSize()?.width === 1920
    ? `artifacts/screenshots/solar-1920-${state}.png`
    : `artifacts/screenshots/solar-1280-${state}.png`
}

async function captureCanvas(page: Page): Promise<PixelFrame> {
  return decodePng(await page.locator('canvas[data-testid="webgl-canvas"]').screenshot())
}

async function hasOverlap(page: Page, first: string, second: string): Promise<boolean> {
  return page.evaluate(([firstSelector, secondSelector]) => {
    const firstRect = document.querySelector(firstSelector)?.getBoundingClientRect()
    const secondRect = document.querySelector(secondSelector)?.getBoundingClientRect()
    if (!firstRect || !secondRect) return false
    return firstRect.left < secondRect.right && firstRect.right > secondRect.left && firstRect.top < secondRect.bottom && firstRect.bottom > secondRect.top
  }, [first, second])
}

if (runningUnderVitest) {
  const { describe: vitestDescribe, it: vitestIt } = await import('vitest')
  vitestDescribe('Playwright registration guard', () => {
    vitestIt('does not register the browser test body under Vitest', () => {})
  })
} else test('verifies the production-preview Solar System experience', async ({ page }, testInfo) => {
  mkdirSync('artifacts/screenshots', { recursive: true })
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const externalRequests: string[] = []
  const allRequests: string[] = []
  const initialDraft = createEvidenceDraft(page, 'initial', INITIAL_SELECTORS, [['header.topbar', '.control-dock'], ['.facts-panel', '.control-dock']])
  const blackHoleDraft = createEvidenceDraft(page, 'black-hole', BLACK_HOLE_SELECTORS, [['.interaction-state', '.control-dock'], ['.facts-panel', '.control-dock']])
  let activeDraft = initialDraft
  let finalAssertionsPassed = false
  let screenshotsWritten = false
  let initialScreenshot: Buffer | undefined
  let blackHoleScreenshot: Buffer | undefined
  let stageObserverInstalled = false
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => {
    const url = request.url()
    allRequests.push(url)
    if (/^https?:\/\//.test(url) && new URL(url).origin !== LOCAL_ORIGIN.slice(0, -1)) externalRequests.push(url)
  })

  try {
    await page.goto('/')
    initialDraft.url = page.url()
    blackHoleDraft.url = page.url()
    await expect.poll(() => REQUIRED_TEXTURE_PATHS.every((path) => allRequests.includes(`${LOCAL_ORIGIN.slice(0, -1)}${path}`)), { timeout: 15_000 }).toBe(true)
    expect(allRequests).toEqual(expect.arrayContaining([LOCAL_ORIGIN]))
    const ready = await waitForReady(page)
    await observeSelectors(page, initialDraft)
    expect(initialDraft.missingSelectors).toEqual([])
    await attachDiagnostics(page, testInfo, 'renderer-and-ready-diagnostics.json')
    console.info(`Orbitarium renderer: ${ready.renderer}`)
    const initialFrame = await captureCanvas(page)
    const initialMetrics = analyzePixels(initialFrame)
    expect(initialMetrics.nonBackgroundCoverage).toBeGreaterThan(0.01)
    expect(initialMetrics.channelVariance).toBeGreaterThan(20)
    initialDraft.pixelCheck = {
      sampled_pixels: initialMetrics.sampledPixels,
      non_blank_pixels: initialMetrics.nonBlankPixels,
      unique_colors: initialMetrics.uniqueColors
    }
    const baselineBefore = ready
    await page.waitForTimeout(750)
    const baselineAfter = await diagnostics(page)
    expect(baselineAfter).not.toBeNull()
    const advancingDiagnostics = baselineAfter as Diagnostics
    expect(Number.isFinite(baselineBefore.simulationTime)).toBe(true)
    expect(Number.isFinite(advancingDiagnostics.simulationTime)).toBe(true)
    expect(advancingDiagnostics.frameCount).toBeGreaterThan(baselineBefore.frameCount)
    expect(advancingDiagnostics.simulationTime).toBeGreaterThan(baselineBefore.simulationTime)
    for (const sample of [...baselineBefore.bodyPositions, ...advancingDiagnostics.bodyPositions]) {
      expect(Number.isFinite(sample.x)).toBe(true)
      expect(Number.isFinite(sample.y)).toBe(true)
      expect(Number.isFinite(sample.z)).toBe(true)
    }
    const movements = orbitalBodyMovements(baselineBefore, advancingDiagnostics)
    expect(movements).toHaveLength(TRACKED_ORBITAL_BODY_IDS.length)
    for (const movement of movements) expect(Number.isFinite(movement.distance)).toBe(true)
    expect(movements.some(({ distance }) => distance > 0 && distance < 1.2)).toBe(true)
    initialDraft.visualStagePassed = true
    initialDraft.skippedReason = null
    initialScreenshot = await page.screenshot({ animations: 'disabled' })

    const canvas = page.locator('canvas[data-testid="webgl-canvas"]')
    const bounds = await canvas.boundingBox()
    expect(bounds).not.toBeNull()
    const canvasBounds = bounds as { x: number; y: number; width: number; height: number }
    const earth = baselineBefore.bodyPositions.find((body) => body.id === 'earth')
    expect(earth).toBeDefined()
    if (!earth) throw new Error('Earth diagnostic position was unavailable for cursor targeting')
    const earthScreen = projectOrbitalPointToCanvas(earth, canvasBounds)
    const hoverOffset = Math.min(96, canvasBounds.width * 0.08)
    const hoverX = earthScreen.x < canvasBounds.x + canvasBounds.width / 2
      ? earthScreen.x + hoverOffset
      : earthScreen.x - hoverOffset
    const hoverY = Math.min(canvasBounds.y + canvasBounds.height - 12, Math.max(canvasBounds.y + 12, earthScreen.y))
    await page.mouse.move(hoverX, hoverY)
    await expect.poll(async () => (await diagnostics(page))?.interactionState, { timeout: 5_000 }).toBe('hover-attractor')
    const hoverBefore = await diagnostics(page)
    await page.waitForTimeout(750)
    const hoverAfter = await diagnostics(page)
    expect(hoverBefore).not.toBeNull()
    expect(hoverAfter).not.toBeNull()
    const hoverMovement = positionDelta(hoverBefore as Diagnostics, hoverAfter as Diagnostics)
    const cursor = projectCursorToOrbitalPlane(hoverX, hoverY, canvasBounds)
    const hoverAttractorMotion = hoverPerturbationTowardCursor(
      baselineBefore,
      baselineAfter as Diagnostics,
      hoverBefore as Diagnostics,
      hoverAfter as Diagnostics,
      'earth',
      cursor
    )
    expect(hoverAttractorMotion).toBeGreaterThan(0.0001)
    expect(hoverMovement).toBeGreaterThan(0.002)
    expect(hoverMovement).toBeLessThan(1.2)
    const hoverFrame = await captureCanvas(page)
    const hoverFrameDifference = frameDifference(initialFrame, hoverFrame)
    expect(hoverFrameDifference).toBeGreaterThan(0.002)

    activeDraft = blackHoleDraft
    // Keep the attractor active, but click a guaranteed empty canvas location.
    // Clicking the nearby body itself marks the pointer gesture as a planet
    // selection, which intentionally prevents the canvas black-hole gesture.
    const clickX = canvasBounds.x + canvasBounds.width / 2
    const clickY = canvasBounds.y + 16
    await page.mouse.click(clickX, clickY)
    // Install the collector immediately after the real click, before any
    // selector or readiness waits. Sampling inside the production-preview
    // page avoids a race between serialized Playwright evaluations and the
    // short diagnostic publication interval at the larger viewport.
    await page.evaluate((stages) => {
      const target = window as Window & {
        __orbitariumObservedAbsorptionStages?: string[]
        __orbitariumAbsorptionStageTimer?: number
      }
      const observed = target.__orbitariumObservedAbsorptionStages ?? []
      const remember = () => {
        const stage = target.__orbitariumDiagnostics?.absorptionState
        if (stage && stages.includes(stage) && !observed.includes(stage)) observed.push(stage)
      }
      remember()
      target.__orbitariumObservedAbsorptionStages = observed
      target.__orbitariumAbsorptionStageTimer = window.setInterval(remember, 10)
    }, STAGES)
    stageObserverInstalled = true
    await expect.poll(async () => (await diagnostics(page))?.interactionState, { timeout: 5_000 }).toBe('black-hole')
    await expect(page.getByText('Black hole active', { exact: true }).first()).toBeVisible()
    await expect.poll(async () => {
      const value = await diagnostics(page)
      return value?.sceneReady && value.renderer !== 'pending' && value.renderer !== 'WebGL unavailable' && value.interactionState === 'black-hole' ? 'event-horizon-ready' : 'transitioning'
    }, { timeout: 5_000, intervals: [50, 100, 250] }).toBe('event-horizon-ready')
    await observeSelectors(page, blackHoleDraft)
    expect(blackHoleDraft.missingSelectors).toEqual([])

    const waitForStage = (stage: string) => expect.poll(async () => {
      return await page.evaluate((expectedStage) => Boolean((window as Window & { __orbitariumObservedAbsorptionStages?: string[] }).__orbitariumObservedAbsorptionStages?.includes(expectedStage)), stage)
    }, { timeout: 10_000, intervals: [50, 100, 250] }).toBe(true)
    await waitForStage('tidal')
    await waitForStage('collapse')
    await waitForStage('fade')
    await waitForStage('consumed')
    const observedStages = await page.evaluate(() => (window as Window & { __orbitariumObservedAbsorptionStages?: string[] }).__orbitariumObservedAbsorptionStages ?? [])
    expect(observedStages).toEqual(expect.arrayContaining(STAGES))
    expect(observedStages.indexOf('tidal')).toBeLessThan(observedStages.indexOf('collapse'))
    expect(observedStages.indexOf('collapse')).toBeLessThan(observedStages.indexOf('fade'))
    expect(observedStages.indexOf('fade')).toBeLessThan(observedStages.indexOf('consumed'))

    const blackHoleBefore = await diagnostics(page)
    await page.waitForTimeout(350)
    const blackHoleAfter = await diagnostics(page)
    expect(blackHoleBefore).not.toBeNull()
    expect(blackHoleAfter).not.toBeNull()
    const blackHoleMotion = positionDelta(blackHoleBefore as Diagnostics, blackHoleAfter as Diagnostics)
    expect(blackHoleMotion).toBeGreaterThan(0.001)
    const blackHoleFrame = await captureCanvas(page)
    const blackHoleRegionalChange = regionalChange(initialFrame, blackHoleFrame)
    expect(blackHoleRegionalChange).toBeGreaterThan(0.002)
    const blackHoleMetrics = analyzePixels(blackHoleFrame)
    blackHoleDraft.pixelCheck = {
      sampled_pixels: blackHoleMetrics.sampledPixels,
      non_blank_pixels: blackHoleMetrics.nonBlankPixels,
      unique_colors: blackHoleMetrics.uniqueColors
    }
    blackHoleDraft.visualStagePassed = true
    blackHoleDraft.skippedReason = null
    blackHoleScreenshot = await page.screenshot({ animations: 'disabled' })

    const pauseButton = page.getByRole('button', { name: /Pause orbit/ })
    await pauseButton.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: /Resume orbit/ })).toBeVisible()
    await page.getByRole('button', { name: /Resume orbit/ }).click()
    await page.getByLabel('Simulation speed').selectOption('2')
    await expect(page.getByLabel('Simulation speed')).toHaveValue('2')
    await page.getByLabel('Render quality').selectOption('cinematic')
    await expect(page.getByLabel('Render quality')).toHaveValue('cinematic')
    await page.getByRole('button', { name: 'Earth' }).click()
    await page.getByRole('button', { name: 'Show facts' }).click()
    await expect(page.locator('.facts-panel')).toContainText('Earth')
    await page.getByRole('button', { name: 'Show measurements' }).click()
    await expect(page.locator('.measurement-legend')).toBeVisible()
    await page.getByRole('button', { name: 'Reset camera' }).click()
    await expect(page.locator('.scene-panel')).toHaveAttribute('data-camera-reset', '1')
    await page.getByRole('button', { name: 'Reset whole scene' }).click()
    await expect(page.locator('.interaction-state')).toContainText('reset')
    await expect(page.getByLabel('Simulation speed')).toHaveValue('1')
    await expect(page.getByRole('button', { name: 'Show facts' })).toBeVisible()
    await expect(page.getByText('Black hole dormant', { exact: true }).first()).toBeVisible()

    const viewportWidth = await page.evaluate(() => window.innerWidth)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    const overflowed = scrollWidth > viewportWidth
    initialDraft.horizontalOverflow = overflowed
    blackHoleDraft.horizontalOverflow = overflowed
    initialDraft.responsiveAssertionCompleted = true
    blackHoleDraft.responsiveAssertionCompleted = true
    expect(overflowed).toBe(false)

    const overlapPairs = [
      { draft: initialDraft, pairs: [['header.topbar', '.control-dock'], ['.facts-panel', '.control-dock']] as const },
      { draft: blackHoleDraft, pairs: [['.interaction-state', '.control-dock'], ['.facts-panel', '.control-dock']] as const }
    ]
    for (const { draft, pairs } of overlapPairs) {
      const failures: string[] = []
      for (const [first, second] of pairs) if (await hasOverlap(page, first, second)) failures.push(overlapFailure(first, second))
      draft.overlapFailures = failures
      expect(failures, `${draft.checkName} has forbidden overlaps`).toEqual([])
    }
    expect(consoleErrors).toEqual([])
    expect(pageErrors).toEqual([])
    const observedHttpRequests = allRequests.filter((url) => /^https?:\/\//.test(url))
    initialDraft.unmatchedExpectedNetwork = [...unmatchedExpectedNetworkPatterns(initialDraft.expectedNetwork, observedHttpRequests)]
    blackHoleDraft.unmatchedExpectedNetwork = [...unmatchedExpectedNetworkPatterns(blackHoleDraft.expectedNetwork, observedHttpRequests)]
    expect(initialDraft.unmatchedExpectedNetwork).toEqual([])
    expect(blackHoleDraft.unmatchedExpectedNetwork).toEqual([])
    // Keep this as the final assertion: the successful run's network boundary
    // is the last fact recorded for each desktop project.
    expect(page.url()).toBe(LOCAL_ORIGIN)
    expect(observedHttpRequests.every((url) => new URL(url).origin === LOCAL_ORIGIN.slice(0, -1))).toBe(true)
    expect(externalRequests).toEqual([])
    expect(new URL(page.url()).origin).toBe(LOCAL_ORIGIN.slice(0, -1))
    initialDraft.finalExactOriginAssertionPassed = true
    blackHoleDraft.finalExactOriginAssertionPassed = true
    finalAssertionsPassed = true
    if (!initialScreenshot || !blackHoleScreenshot) throw new Error('Screenshot visual-stage gates did not retain both frames')
    await writeFile(screenshotName(page, 'initial'), initialScreenshot)
    await writeFile(screenshotName(page, 'black-hole'), blackHoleScreenshot)
    screenshotsWritten = true
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    addFailure(activeDraft, reason)
    if (initialDraft.visualStagePassed) addFailure(initialDraft, `The complete browser verification did not finish: ${reason}`)
    if (blackHoleDraft.visualStagePassed) addFailure(blackHoleDraft, `The complete browser verification did not finish: ${reason}`)
    throw error
  } finally {
    if (stageObserverInstalled) {
      await page.evaluate(() => {
        const target = window as Window & { __orbitariumAbsorptionStageTimer?: number }
        if (target.__orbitariumAbsorptionStageTimer !== undefined) window.clearInterval(target.__orbitariumAbsorptionStageTimer)
      }).catch(() => undefined)
    }
    const observedErrors = [...consoleErrors, ...pageErrors.map((error) => `pageerror: ${error}`)]
    const observedHttpRequests = allRequests.filter((url) => /^https?:\/\//.test(url))
    initialDraft.unmatchedExpectedNetwork = [...unmatchedExpectedNetworkPatterns(initialDraft.expectedNetwork, observedHttpRequests)]
    blackHoleDraft.unmatchedExpectedNetwork = [...unmatchedExpectedNetworkPatterns(blackHoleDraft.expectedNetwork, observedHttpRequests)]
    const reports = [initialDraft, blackHoleDraft].map((draft) => {
      const realPixelCheck = hasConcretePixelCheck(draft.pixelCheck) && draft.pixelCheck.sampled_pixels > 0 && draft.pixelCheck.non_blank_pixels > 0 && draft.pixelCheck.unique_colors > 0
      const passed = finalAssertionsPassed && screenshotsWritten && draft.visualStagePassed && draft.missingSelectors.length === 0 && realPixelCheck && draft.responsiveAssertionCompleted && !draft.horizontalOverflow && draft.overlapFailures.length === 0 && draft.unmatchedExpectedNetwork.length === 0 && draft.finalExactOriginAssertionPassed && observedErrors.length === 0
      const status: EvidenceStatus = passed ? 'passed' : draft.failureReasons.length > 0 || draft.visualStagePassed ? 'failed' : 'skipped'
      const skippedReason = status === 'skipped' ? draft.skippedReason : null
      const failureReasons = status === 'failed' && draft.failureReasons.length === 0 ? ['The browser check did not reach every required final assertion.'] : draft.failureReasons
      return evidenceReport(draft, observedErrors, allRequests, status, failureReasons, skippedReason)
    })
    await writeEvidenceBundle(reports)
  }
})

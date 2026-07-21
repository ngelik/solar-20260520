/* global Blob, HTMLCanvasElement, URL, atob, console, createImageBitmap, document, fetch, process, setTimeout, window */

import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

const ORIGIN = 'http://127.0.0.1:4173/'
const CHECKS = [
  { name: 'solar-1280-initial', width: 1280, height: 720, state: 'initial', artifact: 'artifacts/screenshots/solar-1280-initial.png' },
  { name: 'solar-1920-initial', width: 1920, height: 1080, state: 'initial', artifact: 'artifacts/screenshots/solar-1920-initial.png' },
  { name: 'solar-1280-black-hole', width: 1280, height: 720, state: 'black-hole', artifact: 'artifacts/screenshots/solar-1280-black-hole.png' },
  { name: 'solar-1920-black-hole', width: 1920, height: 1080, state: 'black-hole', artifact: 'artifacts/screenshots/solar-1920-black-hole.png' }
]
const REQUIRED_TARGETS = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'saturn-rings']
const SELECTORS = {
  shell: '[data-testid="solar-system-shell"]',
  canvas: '[data-testid="solar-system-canvas"]',
  ready: '[data-scene-ready="true"]',
  blackHole: '[data-testid="black-hole-toggle"][aria-pressed="true"]'
}
const EVIDENCE_PATH = process.env.BRAIN_HANDS_BROWSER_EVIDENCE_REPORT
const EXPECTED_NETWORK = [ORIGIN, `${ORIGIN}textures/**`]
const FORBIDDEN_OVERLAPS = [
  ['.topbar', '.control-dock'],
  ['.facts-panel', '.control-dock'],
  ['.interaction-state', '.control-dock']
]
const screenshotRoot = resolve('artifacts/screenshots')

function emptyReport(check) {
  return {
    check_name: check.name,
    url: ORIGIN,
    status: 'skipped',
    observed_selectors: [],
    missing_selectors: [],
    console_errors: [],
    expected_network: EXPECTED_NETWORK,
    observed_network: [],
    screenshot_artifact: check.artifact,
    console_error_policy: 'no_errors',
    viewport: { width: check.width, height: check.height, mobile: false },
    horizontal_overflow: false,
    overlap_failures: [],
    final_exact_origin_assertion_passed: false,
    pixel_check: { sampled_pixels: 0, non_blank_pixels: 0, unique_colors: 0 },
    failure_reasons: [],
    skipped_reason: 'The production-preview check did not complete.'
  }
}

async function waitForPreview(preview) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(ORIGIN)
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`Production preview did not start${preview.exitCode === null ? '' : ` (exit ${preview.exitCode})`}`)
}

async function diagnostics(page) {
  return page.evaluate(() => {
    const value = window.__orbitariumDiagnostics
    return value ? JSON.parse(JSON.stringify(value)) : null
  })
}

function hasPostToggleStateChange(before, after) {
  if (!before || !after) return false
  if (before.interactionState !== after.interactionState) return true
  if (before.absorptionState !== after.absorptionState) return true
  const beforeBodies = Array.isArray(before.bodyPositions) ? before.bodyPositions : []
  const afterBodies = Array.isArray(after.bodyPositions) ? after.bodyPositions : []
  if (beforeBodies.length !== afterBodies.length) return true
  return beforeBodies.some((beforeBody, index) => {
    const afterBody = afterBodies[index]
    if (!afterBody || beforeBody.id !== afterBody.id) return true
    return ['x', 'y', 'z', 'shrink', 'fade', 'tidalElongation', 'absorptionProgress'].some((key) => beforeBody[key] !== afterBody[key])
  })
}

async function inspectCanvasPixels(page, diagnosticsValue, captureBase64) {
  return page.evaluate(async ({ sceneDiagnostics, encodedCapture, requiredTargets }) => {
    const canvas = document.querySelector('[data-testid="solar-system-canvas"]')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('The real WebGL canvas was not found')
    const canvasRect = canvas.getBoundingClientRect()
    if (canvasRect.width <= 0 || canvasRect.height <= 0) throw new Error('The real WebGL canvas had no measurable CSS bounds')
    const imageBytes = Uint8Array.from(atob(encodedCapture), (character) => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([imageBytes], { type: 'image/png' }))
    const analysisCanvas = document.createElement('canvas')
    analysisCanvas.width = image.width
    analysisCanvas.height = image.height
    const context = analysisCanvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('The in-memory canvas decoder was not available')
    context.drawImage(image, 0, 0)
    const { data: pixels } = context.getImageData(0, 0, image.width, image.height)
    const width = image.width
    const height = image.height
    const colors = new Set()
    const failures = []
    let sampledPixels = 0
    let nonBlankPixels = 0
    const readPixel = (x, y) => {
      const sampleX = Math.max(0, Math.min(width - 1, Math.round(x)))
      const sampleY = Math.max(0, Math.min(height - 1, Math.round(y)))
      const index = (sampleY * width + sampleX) * 4
      return [pixels[index], pixels[index + 1], pixels[index + 2]]
    }
    const colorDistance = (first, second) => Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2])
    const scaleX = width / canvasRect.width
    const scaleY = height / canvasRect.height
    const bounds = sceneDiagnostics.screenSpaceBounds ?? {}
    const silhouettes = sceneDiagnostics.targetSilhouettes ?? {}
    const background = readPixel(2, 2)

    for (const key of requiredTargets) {
      const bound = bounds[key]
      const samples = Array.isArray(silhouettes[key]) ? silhouettes[key] : []
      if (!bound || !bound.visible || samples.length === 0 || bound.left < 0 || bound.top < 0 || bound.right > canvasRect.width || bound.bottom > canvasRect.height) {
        failures.push(`${key} is outside the canvas viewport or has no truthful projected silhouette`)
        continue
      }

      const candidateSamples = samples.filter((sample) => sample.visible && sample.x >= bound.left && sample.x <= bound.right && sample.y >= bound.top && sample.y <= bound.bottom)
      const ownedCells = new Set()
      let targetContrast = 0
      let adjacentContrast = 0
      for (const sample of candidateSamples) {
        const x = sample.x * scaleX
        const y = sample.y * scaleY
        const pixel = readPixel(x, y)
        const contrast = colorDistance(pixel, background)
        const centerX = bound.centerX * scaleX
        const centerY = bound.centerY * scaleY
        const directionX = x - centerX
        const directionY = y - centerY
        const length = Math.max(1, Math.hypot(directionX, directionY))
        const outside = readPixel(x + (directionX / length) * 5 * scaleX, y + (directionY / length) * 5 * scaleY)
        sampledPixels += 1
        colors.add((pixel[0] << 16) | (pixel[1] << 8) | pixel[2])
        if (contrast > 18) {
          targetContrast += 1
          nonBlankPixels += 1
          ownedCells.add(`${Math.floor(sample.x / 4)}:${Math.floor(sample.y / 4)}`)
        }
        if (colorDistance(pixel, outside) > 12) adjacentContrast += 1
      }
      if (targetContrast < 2 || ownedCells.size < 2 || adjacentContrast < 2) failures.push(`${key} lacks target-owned contrast and adjacent background separation`)
    }
    image.close()
    return { sampled_pixels: sampledPixels, non_blank_pixels: nonBlankPixels, unique_colors: colors.size, failures }
  }, { sceneDiagnostics: diagnosticsValue, encodedCapture: captureBase64, requiredTargets: REQUIRED_TARGETS })
}

async function captureCanvasRegion(page) {
  const rect = await page.locator(SELECTORS.canvas).evaluate((element) => {
    const value = element.getBoundingClientRect()
    return { x: value.x, y: value.y, width: value.width, height: value.height }
  })
  if (rect.width <= 0 || rect.height <= 0) throw new Error('The real WebGL canvas had no measurable CSS bounds')
  return page.screenshot({ clip: rect, type: 'png', animations: 'disabled' })
}

async function runCheck(browser, check) {
  const report = emptyReport(check)
  await rm(resolve(check.artifact), { force: true })
  const page = await browser.newPage({ viewport: { width: check.width, height: check.height }, deviceScaleFactor: 1 })
  const consoleErrors = []
  const requests = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  page.on('request', (request) => requests.push(request.url()))
  try {
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
    report.url = page.url()
    const expectedSelectors = [SELECTORS.shell, SELECTORS.canvas, SELECTORS.ready]
    if (check.state === 'black-hole') expectedSelectors.push(SELECTORS.blackHole)
    await page.locator(SELECTORS.shell).waitFor({ state: 'attached', timeout: 15_000 })
    await page.locator(SELECTORS.canvas).waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator(SELECTORS.ready).waitFor({ state: 'attached', timeout: 15_000 })
    let postToggleBaseline = null
    if (check.state === 'black-hole') {
      await page.locator('[data-testid="black-hole-toggle"]').click()
      await page.locator(SELECTORS.blackHole).waitFor({ state: 'attached', timeout: 5_000 })
      await page.waitForFunction(() => window.__orbitariumDiagnostics?.interactionState === 'black-hole', null, { timeout: 5_000 })
      postToggleBaseline = await diagnostics(page)
    }
    report.observed_selectors = []
    for (const selector of expectedSelectors) if (await page.locator(selector).count() > 0) report.observed_selectors.push(selector)
    report.missing_selectors = expectedSelectors.filter((selector) => !report.observed_selectors.includes(selector))
    await page.waitForTimeout(180)
    const value = await diagnostics(page)
    if (!value?.sceneReady || !value.screenSpaceBounds || !value.targetSilhouettes) throw new Error('Read-only target silhouettes were not ready')
    if (check.state === 'black-hole') {
      if (value.interactionState !== 'black-hole') report.failure_reasons.push('The black-hole interaction was not active immediately before capture')
      if (!hasPostToggleStateChange(postToggleBaseline, value)) report.failure_reasons.push('The active black-hole state did not produce a post-toggle body-state change')
    }
    const canvasCapture = await captureCanvasRegion(page)
    const pixelCheck = await inspectCanvasPixels(page, value, canvasCapture.toString('base64'))
    report.pixel_check = { sampled_pixels: Math.max(0, pixelCheck.sampled_pixels), non_blank_pixels: Math.max(0, pixelCheck.non_blank_pixels), unique_colors: Math.max(0, pixelCheck.unique_colors) }
    report.failure_reasons.push(...pixelCheck.failures)
    report.horizontal_overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    if (report.horizontal_overflow) report.failure_reasons.push('The page has horizontal overflow')
    report.observed_network = requests.filter((url) => /^https?:\/\//.test(url))
    if (!report.observed_network.includes(ORIGIN)) report.failure_reasons.push('The preview origin was not observed')
    if (!report.observed_network.some((url) => url.startsWith(`${ORIGIN}textures/`))) report.failure_reasons.push('No local texture requests were observed')
    report.final_exact_origin_assertion_passed = await page.evaluate((expectedOrigin) => {
      const current = new URL(window.location.href)
      return current.origin === expectedOrigin && current.href === `${expectedOrigin}/`
    }, new URL(ORIGIN).origin) && report.observed_network.every((url) => new URL(url).origin === new URL(ORIGIN).origin)
    if (!report.final_exact_origin_assertion_passed) report.failure_reasons.push('The final page URL or observed request origin was not exactly local')
    report.overlap_failures = await page.evaluate((pairs) => pairs.flatMap(([firstSelector, secondSelector]) => {
      const first = document.querySelector(firstSelector)?.getBoundingClientRect()
      const second = document.querySelector(secondSelector)?.getBoundingClientRect()
      if (!first || !second) return []
      const intersects = first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
      return intersects ? [`${firstSelector} overlaps ${secondSelector}`] : []
    }), FORBIDDEN_OVERLAPS)
    report.failure_reasons.push(...report.overlap_failures)
    if (consoleErrors.length > 0) report.failure_reasons.push('Console errors were emitted')
    if (report.missing_selectors.length > 0) report.failure_reasons.push(`Missing selectors: ${report.missing_selectors.join(', ')}`)
    if (report.failure_reasons.length === 0) {
      await mkdir(screenshotRoot, { recursive: true })
      await page.screenshot({ path: resolve(check.artifact), animations: 'disabled' })
      report.status = 'passed'
      report.skipped_reason = null
    } else {
      await rm(resolve(check.artifact), { force: true })
      report.status = 'failed'
      report.skipped_reason = null
    }
  } catch (error) {
    report.failure_reasons.push(error instanceof Error ? error.message : String(error))
    report.status = report.observed_selectors.length > 0 ? 'failed' : 'skipped'
    report.skipped_reason = report.status === 'skipped' ? 'The browser could not complete the check gates.' : null
    await rm(resolve(check.artifact), { force: true })
  } finally {
    report.console_errors = [...consoleErrors]
    if (report.observed_network.length === 0) report.observed_network = requests.filter((url) => /^https?:\/\//.test(url))
    await page.close()
  }
  return report
}

async function main() {
  // Invalidate every planned artifact before the first browser action so a
  // failed run can never leave a stale passing image behind.
  await Promise.all(CHECKS.map((check) => rm(resolve(check.artifact), { force: true })))
  const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173'], { stdio: 'ignore' })
  let browser
  const reports = []
  try {
    await waitForPreview(preview)
    browser = await chromium.launch({ headless: true })
    for (const check of CHECKS) reports.push(await runCheck(browser, check))
  } catch (error) {
    for (const check of CHECKS.slice(reports.length)) {
      const report = emptyReport(check)
      report.failure_reasons.push(error instanceof Error ? error.message : String(error))
      reports.push(report)
    }
  } finally {
    await browser?.close()
    preview.kill('SIGTERM')
  }
  const bundle = { generated_at: new Date().toISOString(), status: reports.every((report) => report.status === 'passed') ? 'passed' : reports.some((report) => report.status === 'failed') ? 'failed' : 'skipped', reports }
  await mkdir(resolve('artifacts'), { recursive: true })
  await writeFile(resolve('artifacts/scene-visibility-report.json'), `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
  if (EVIDENCE_PATH) {
    if (!isAbsolute(EVIDENCE_PATH)) throw new Error('BRAIN_HANDS_BROWSER_EVIDENCE_REPORT must be an absolute path')
    await mkdir(resolve(EVIDENCE_PATH, '..'), { recursive: true })
    await writeFile(EVIDENCE_PATH, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
  }
  if (bundle.status !== 'passed') {
    throw new Error(`Scene visibility verification ${bundle.status}: ${JSON.stringify(reports)}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

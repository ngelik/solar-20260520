/* global Blob, HTMLCanvasElement, atob, console, createImageBitmap, document, fetch, process, setTimeout, window */

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
const REQUIRED_BOUNDS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'saturn-rings']
const SELECTORS = {
  shell: '[data-testid="solar-system-shell"]',
  canvas: '[data-testid="webgl-canvas"]',
  ready: '[data-scene-ready="true"]',
  blackHole: '[data-testid="black-hole-toggle"][aria-pressed="true"]'
}
const EVIDENCE_PATH = process.env.BRAIN_HANDS_BROWSER_EVIDENCE_REPORT
const EXPECTED_NETWORK = [ORIGIN, `${ORIGIN}textures/**`]
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

async function inspectCanvasPixels(page, bounds, captureBase64) {
  return page.evaluate(async ({ targetBounds, encodedCapture }) => {
    const canvas = document.querySelector('[data-testid="webgl-canvas"]')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('The real WebGL canvas was not found')
    const canvasRect = canvas.getBoundingClientRect()
    if (canvasRect.width <= 0 || canvasRect.height <= 0) throw new Error('The real WebGL canvas had no measurable CSS bounds')
    const imageBytes = Uint8Array.from(atob(encodedCapture), (character) => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([imageBytes], { type: 'image/png' }))
    if (image.width <= 0 || image.height <= 0) throw new Error('The in-memory canvas capture had no pixels')
    const analysisCanvas = document.createElement('canvas')
    analysisCanvas.width = image.width
    analysisCanvas.height = image.height
    const context = analysisCanvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('The in-memory canvas decoder was not available')
    context.drawImage(image, 0, 0)
    const { data: pixels } = context.getImageData(0, 0, image.width, image.height)
    const width = image.width
    const height = image.height
    const cssWidth = canvasRect.width
    const cssHeight = canvasRect.height
    const background = [pixels[0], pixels[1], pixels[2]]
    const colors = new Set()
    let sampledPixels = 0
    let nonBlankPixels = 0
    const failures = []
    for (const [key, value] of Object.entries(targetBounds)) {
      if (!value || !value.visible || value.left < 0 || value.top < 0 || value.right > cssWidth || value.bottom > cssHeight) {
        failures.push(`${key} is outside the canvas viewport`)
        continue
      }
      const x0 = Math.max(0, Math.floor(value.left * width / cssWidth))
      const y0 = Math.max(0, Math.floor(value.top * height / cssHeight))
      const x1 = Math.min(width, Math.ceil(value.right * width / cssWidth))
      const y1 = Math.min(height, Math.ceil(value.bottom * height / cssHeight))
      let targetContrast = 0
      const step = Math.max(1, Math.floor(Math.min(width, height) / 160))
      for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
        // Playwright's PNG capture and Canvas 2D ImageData both use a
        // top-left origin, matching the projected diagnostic CSS bounds.
        const index = (y * width + x) * 4
        const red = pixels[index]
        const green = pixels[index + 1]
        const blue = pixels[index + 2]
        colors.add((red << 16) | (green << 8) | blue)
        sampledPixels += 1
        if (Math.hypot(red - background[0], green - background[1], blue - background[2]) > 18) {
          nonBlankPixels += 1
          targetContrast += 1
        }
      }
      if (targetContrast < 2) failures.push(`${key} has no individually readable canvas contrast`)
    }
    image.close()
    return { sampled_pixels: sampledPixels, non_blank_pixels: nonBlankPixels, unique_colors: colors.size, failures }
  }, { targetBounds: bounds, encodedCapture: captureBase64 })
}

async function captureCanvasRegion(page) {
  const rect = await page.locator(SELECTORS.canvas).evaluate((element) => {
    const value = element.getBoundingClientRect()
    return { x: value.x, y: value.y, width: value.width, height: value.height }
  })
  if (rect.width <= 0 || rect.height <= 0) throw new Error('The real WebGL canvas had no measurable CSS bounds')
  return page.screenshot({
    clip: rect,
    type: 'png',
    animations: 'disabled'
  })
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
    await page.locator(SELECTORS.canvas).waitFor({ state: 'visible', timeout: 15_000 })
    await page.locator(SELECTORS.ready).waitFor({ state: 'attached', timeout: 15_000 })
    if (check.state === 'black-hole') {
      await page.locator('[data-testid="black-hole-toggle"]').click()
      await page.locator(SELECTORS.blackHole).waitFor({ state: 'attached', timeout: 5_000 })
      await page.waitForFunction(() => window.__orbitariumDiagnostics?.interactionState === 'black-hole' || window.__orbitariumDiagnostics?.absorptionState !== 'none', null, { timeout: 5_000 })
    }
    report.observed_selectors = []
    for (const selector of expectedSelectors) if (await page.locator(selector).count() > 0) report.observed_selectors.push(selector)
    report.missing_selectors = expectedSelectors.filter((selector) => !report.observed_selectors.includes(selector))
    await page.waitForTimeout(180)
    const value = await diagnostics(page)
    if (!value?.sceneReady || !value.screenSpaceBounds) throw new Error('Read-only scene diagnostics were not ready')
    const canvasCapture = await captureCanvasRegion(page)
    const pixelCheck = await inspectCanvasPixels(page, Object.fromEntries(REQUIRED_BOUNDS.map((key) => [key, value.screenSpaceBounds[key]])), canvasCapture.toString('base64'))
    report.pixel_check = { sampled_pixels: Math.max(0, pixelCheck.sampled_pixels), non_blank_pixels: Math.max(0, pixelCheck.non_blank_pixels), unique_colors: Math.max(0, pixelCheck.unique_colors) }
    report.failure_reasons.push(...pixelCheck.failures)
    report.horizontal_overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    if (report.horizontal_overflow) report.failure_reasons.push('The page has horizontal overflow')
    report.observed_network = requests.filter((url) => /^https?:\/\//.test(url))
    if (report.observed_network.filter((url) => url === ORIGIN).length === 0) report.failure_reasons.push('The preview origin was not observed')
    if (!report.observed_network.some((url) => url.startsWith(`${ORIGIN}textures/`))) report.failure_reasons.push('No local texture requests were observed')
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

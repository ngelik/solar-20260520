import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SCREENSHOTS = [
  'artifacts/screenshots/solar-1280-initial.png',
  'artifacts/screenshots/solar-1280-black-hole.png',
  'artifacts/screenshots/solar-1920-initial.png',
  'artifacts/screenshots/solar-1920-black-hole.png'
]

async function run(label, command, args) {
  try {
    const result = await execFileAsync(command, args, { maxBuffer: 2 * 1024 * 1024 })
    return { ok: true, value: result.stdout.trim() }
  } catch (error) {
    return { ok: false, label, exitCode: error?.code ?? 1 }
  }
}

function issueNumber(value) {
  const match = String(value ?? '').match(/(?:issues\/|#)(\d+)/)
  return match?.[1] ?? null
}

function issueOnLine(body, pattern) {
  const line = body.split('\n').find((candidate) => pattern.test(candidate))
  return issueNumber(line)
}

function evidenceLine(body, pattern) {
  return body.split('\n').some((line) => pattern.test(line) && /(?:pass|success|successful|exit[_ ]?code\s*0|✅)/i.test(line))
}

function hasScreenshotLink(body, path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:\\]\\([^)]*${escaped}|${escaped})`, 'i').test(body)
}

function controllerIssue(name, body, pattern) {
  const explicit = process.env[name]
  return issueNumber(explicit) ?? issueOnLine(body, pattern)
}

async function main() {
  const phase = process.env.BRAIN_HANDS_VERIFICATION_PHASE ?? 'work_item'
  if (phase !== 'post_pr') {
    return succeed({
      phase,
      strictPostPrChecks: false,
      secretFree: true
    })
  }

  const branchResult = await run('branch', 'git', ['branch', '--show-current'])
  if (!branchResult.ok || !branchResult.value) return fail('Unable to determine the preserved current branch', branchResult)

  const authResult = await run('auth', 'gh', ['api', 'user', '--jq', '.login'])
  if (!authResult.ok || !authResult.value) return fail('GitHub authentication metadata is unavailable', authResult)

  const repoResult = await run('repo', 'gh', ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef'])
  if (!repoResult.ok) return fail('Unable to inspect repository default-branch metadata', repoResult)

  let repo
  try {
    repo = JSON.parse(repoResult.value)
  } catch {
    return fail('Repository metadata was not machine-readable')
  }
  const repository = repo.nameWithOwner
  const defaultBranch = repo.defaultBranchRef?.name
  const branch = branchResult.value
  if (!repository || !defaultBranch) return fail('Repository metadata omitted name or default branch')

  const prResult = await run('pull-requests', 'gh', [
    'pr', 'list', '--repo', repository, '--state', 'all', '--head', branch, '--limit', '100',
    '--json', 'number,state,isDraft,mergedAt,baseRefName,headRefName,url,body'
  ])
  if (!prResult.ok) return fail('Unable to inspect pull-request metadata', prResult)

  let pullRequests
  try {
    pullRequests = JSON.parse(prResult.value)
  } catch {
    return fail('Pull-request metadata was not machine-readable')
  }
  if (!Array.isArray(pullRequests) || pullRequests.length !== 1) {
    return fail('The preserved branch must have exactly one pull request', { count: pullRequests?.length ?? 0 })
  }

  const pullRequest = pullRequests[0]
  const body = String(pullRequest.body ?? '')
  const identityChecks = {
    singlePullRequest: true,
    headBranch: pullRequest.headRefName === branch,
    defaultBranch: pullRequest.baseRefName === defaultBranch,
    open: pullRequest.state === 'OPEN',
    unmerged: !pullRequest.mergedAt,
    notDraft: !pullRequest.isDraft
  }
  if (Object.values(identityChecks).some((value) => !value)) return fail('Pull-request delivery identity is mismatched', identityChecks)

  const headResult = await run('head-revision', 'gh', ['api', `repos/${repository}/pulls/${pullRequest.number}`, '--jq', '.head.sha'])
  if (!headResult.ok || !/^[0-9a-f]{40}$/i.test(headResult.value)) {
    return fail('Unable to obtain the pull request immutable head commit identity', headResult)
  }
  const headRevision = headResult.value

  const rollupIssue = controllerIssue('CONTROLLER_ROLLUP_ISSUE', body, /roll[- ]?up/i)
  const workItemIssue = controllerIssue('CONTROLLER_WORK_ITEM_ISSUE', body, /scoped|work[- ]?item/i)
  if (!rollupIssue || !workItemIssue || rollupIssue === workItemIssue) return fail('Both distinct controller-managed issue links are required')

  const issueChecks = {}
  for (const [kind, number] of [['rollup', rollupIssue], ['workItem', workItemIssue]]) {
    const issueResult = await run(`${kind}-issue`, 'gh', ['api', `repos/${repository}/issues/${number}`])
    if (!issueResult.ok) return fail(`Unable to inspect ${kind} issue metadata`, issueResult)
    try {
      const issue = JSON.parse(issueResult.value)
      issueChecks[kind] = issue.state === 'open' && !issue.pull_request
      if (!issueChecks[kind]) return fail(`${kind} link is not an existing open issue`, issueChecks)
    } catch {
      return fail(`${kind} issue metadata was not machine-readable`)
    }
  }

  const evidenceChecks = {
    productionBuild: evidenceLine(body, /npx\s+vite\s+build/),
    desktop1280: evidenceLine(body, /(?:desktop[- ]?1280|project=desktop-1280)/i),
    desktop1920: evidenceLine(body, /(?:desktop[- ]?1920|project=desktop-1920)/i),
    fullPlaywright: body.split('\n').some((line) => /npx\s+playwright\s+test\s*$/.test(line.trim()) && /(?:pass|success|successful|exit[_ ]?code\s*0|✅)/i.test(line)),
    renderer: /renderer/i.test(body) && /(?:hardware|software|swiftshader|webgl|angle)/i.test(body) && /(?:dpr|device pixel ratio|browser)/i.test(body),
    screenshots: Object.fromEntries(SCREENSHOTS.map((path) => [path, hasScreenshotLink(body, path)]))
  }
  const allScreenshots = Object.values(evidenceChecks.screenshots).every(Boolean)
  if (!evidenceChecks.productionBuild || !evidenceChecks.desktop1280 || !evidenceChecks.desktop1920 || !evidenceChecks.fullPlaywright || !evidenceChecks.renderer || !allScreenshots) {
    return fail('Pull request is missing required successful delivery evidence', evidenceChecks)
  }

  const screenshotsAtHead = {}
  for (const path of SCREENSHOTS) {
    const fileResult = await run(`head-screenshot:${path}`, 'gh', ['api', `repos/${repository}/contents/${path}?ref=${headRevision}`])
    if (!fileResult.ok) {
      screenshotsAtHead[path] = { present: false, type: 'unavailable' }
      return fail('Approved screenshot is unavailable at the immutable pull-request head revision', {
        headRevision,
        screenshotsAtHead
      })
    }
    try {
      const file = JSON.parse(fileResult.value)
      const present = !Array.isArray(file) && file?.type === 'file' && file?.path === path
      screenshotsAtHead[path] = {
        present,
        type: Array.isArray(file) ? 'array' : file?.type ?? null,
        path: file?.path ?? null,
        revision: headRevision
      }
      if (!present) {
        return fail('Approved screenshot is not a file at the immutable pull-request head revision', {
          headRevision,
          screenshotsAtHead
        })
      }
    } catch {
      screenshotsAtHead[path] = { present: false, type: 'invalid-response', revision: headRevision }
      return fail('Screenshot-at-head metadata was not machine-readable', { headRevision, screenshotsAtHead })
    }
  }

  return succeed({
    repository,
    defaultBranch,
    branch,
    pullRequest: { number: pullRequest.number, state: pullRequest.state, merged: Boolean(pullRequest.mergedAt) },
    issueLinks: { rollup: Number(rollupIssue), workItem: Number(workItemIssue) },
    headRevision,
    evidence: evidenceChecks,
    screenshotsAtHead,
    secretFree: true
  })
}

function fail(message, details = {}) {
  process.stdout.write(`${JSON.stringify({ ok: false, message, details, secretFree: true })}\n`)
  process.exitCode = 1
}

function succeed(details) {
  process.stdout.write(`${JSON.stringify({ ok: true, ...details })}\n`)
}

await main()

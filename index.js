import fs from 'node:fs/promises'
import fss from 'node:fs'
import path from 'node:path'
import * as core from '@actions/core'
import { fdir } from 'fdir'
import { exec } from 'tinyexec'

const REPO_URL = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`

main()

async function main() {
  const mapLines = core.getMultilineInput('map', { required: true })
  const skipUnchangedCheck = core.getBooleanInput('skip-unchanged-check')
  const dryRun = core.getBooleanInput('dry-run')
  const ghToken = core.getInput('token')
  let previousLineSkipped = false

  for (let i = 0; i < mapLines.length; i++) {
    const line = mapLines[i]
    let [sourceDir, targetBranch] = line.split('->')

    sourceDir = sourceDir.trim()
    if (!sourceDir) {
      core.warning(`Invalid line: "${line}". First parameter is empty`)
      continue
    }

    targetBranch = targetBranch?.trim()
    if (!targetBranch) {
      core.warning(`Invalid line: "${line}". Second parameter is empty`)
      continue
    }

    if (sourceDir.includes('*')) {
      const additionalLinesToInject = expandGlobLine(sourceDir, targetBranch)
      mapLines.splice(i + 1, 0, ...additionalLinesToInject)
      continue
    }

    if (skipUnchangedCheck) {
      core.debug('Skip unchanged check')
    } else if (
      // skip if git branch exists and source directory has not changed
      !(await isGitBranchExists(targetBranch)) &&
      !(await hasGitChanged(sourceDir))
    ) {
      core.info(
        yellow(
          `Skip sync "${sourceDir}" directory to "${targetBranch}" branch as unchanged`,
        ),
      )
      previousLineSkipped = true
      continue
    }

    // Add new line spacing between the last skip and the next sync so it's easier to read
    if (previousLineSkipped) {
      console.log()
      previousLineSkipped = false
    }

    core.info(blue(`Sync "${sourceDir}" directory to "${targetBranch}" branch`))
    await gitForcePush(sourceDir, targetBranch, dryRun, ghToken)
    console.log()
  }
}

/**
 * @param {string} branch
 */
async function isGitBranchExists(branch) {
  const result = exec('git', ['show-ref', '--quiet', `refs/heads/${branch}`])
  await result
  return result.exitCode === 0
}

/**
 * @param {string} sourceDir
 */
async function hasGitChanged(sourceDir) {
  if (sourceDir[0] === '/') {
    sourceDir = sourceDir.slice(1)
  }
  if (sourceDir === '') {
    sourceDir = '.'
  }

  const result = exec(
    'git',
    ['diff', '--quiet', 'HEAD', 'HEAD~1', '--', sourceDir],
    { nodeOptions: { stdio: ['ignore', 'inherit', 'inherit'] } },
  )

  await result
  return result.exitCode === 1
}

/**
 * @param {string} sourceDir
 * @param {string} targetBranch
 * @param {boolean} dryRun
 * @param {string} ghToken
 */
async function gitForcePush(sourceDir, targetBranch, dryRun, ghToken) {
  const sourcePath = path.join(process.cwd(), sourceDir)
  const o = {
    nodeOptions: { stdio: ['ignore', 'inherit', 'inherit'] },
    throwOnError: true,
  }

  core.debug(`Changing directory to "${sourcePath}"`)
  const originalCwd = process.cwd()
  process.chdir(sourcePath)

  const gitDir = path.join(sourcePath, '.git')
  const commitMessage = `Sync from ${process.env.GITHUB_SHA}`

  try {
    // Re-use existing git if available (e.g. root)
    if (fss.existsSync(gitDir)) {
      core.debug(`Found existing git directory at "${gitDir}"`)
      core.debug(`Force pushing to "${targetBranch}" branch`)
      if (dryRun) {
        core.info(`\
[dry run]
git checkout -d ${targetBranch}
git checkout --orphan ${targetBranch}
git config user.name github-actions[bot]
git config user.email 41898282+github-actions[bot]@users.noreply.github.com
git commit -am "${commitMessage}"
git push -f origin HEAD:${targetBranch}
git checkout ${process.env.GITHUB_REF_NAME}`)
      } else {
        await x('git', ['checkout', '-d', targetBranch], false)
        await x('git', ['checkout', '--orphan', targetBranch])
        await x('git', ['config', 'user.name', 'github-actions[bot]'])
        // prettier-ignore
        await x('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
        await x('git', ['commit', '-am', commitMessage])
        await x('git', ['push', '-f', 'origin', `HEAD:${targetBranch}`])
        await x('git', ['checkout', process.env.GITHUB_REF_NAME])
      }
    } else {
      core.debug(`Initializing git repository at "${sourcePath}"`)
      // Custom git init requires own authorization setup (inspired from actions/checkout)
      const repoUrl = new URL(REPO_URL)
      repoUrl.username = 'x-access-token'
      repoUrl.password = ghToken
      if (dryRun) {
        core.info(`\
[dry run]
git init -b ${targetBranch}
git config user.name github-actions[bot]
git config user.email 41898282+github-actions[bot]@users.noreply.github.com
git add .
git commit -m "${commitMessage}"
git remote add origin ${REPO_URL}
git push -f origin HEAD:${targetBranch}`)
      } else {
        await x('git', ['init', '-b', targetBranch])
        await x('git', ['config', 'user.name', 'github-actions[bot]'])
        // prettier-ignore
        await x('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
        await x('git', ['add', '.'])
        await x('git', ['commit', '-m', commitMessage])
        await x('git', ['remote', 'add', 'origin', repoUrl])
        core.debug(`Force pushing to "${targetBranch}" branch`)
        await x('git', ['push', '-f', 'origin', `HEAD:${targetBranch}`])
        await fs.rm(gitDir, { recursive: true, force: true })
      }
    }
  } finally {
    core.debug(`Changing directory back to "${originalCwd}"`)
    process.chdir(originalCwd)
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {boolean} inherit
 */
async function x(command, args, inherit = true) {
  // NOTE: while this may log GH_TOKEN, github seems to help auto redact it
  core.startGroup(`${command} ${args.join(' ')}`)
  try {
    await exec(
      command,
      args,
      inherit
        ? {
            nodeOptions: { stdio: ['ignore', 'inherit', 'inherit'] },
            throwOnError: true,
          }
        : undefined,
    )
  } finally {
    core.endGroup()
  }
}

/**
 * @param {string} sourceDir
 * @param {string} targetBranch
 */
function expandGlobLine(sourceDir, targetBranch) {
  const regex = createGlobalRegExp(sourceDir)

  // Get parent directories before the first * so we can use it to exclude out directories earlier
  const sourceParentDirs = getParentDirs(sourceDir, process.cwd())

  // Do the globbing!
  const result = new fdir()
    .withRelativePaths()
    .withPathSeparator('/')
    .onlyDirs()
    .exclude((_, dirPath) => {
      return !sourceParentDirs.some((p) => dirPath.startsWith(p))
    })
    .filter((p, isDir) => {
      // NOTE: directory path always have a trailing slash
      return isDir && p !== '.' && regex.test('/' + p.replace(/\\/g, '/'))
    })
    .crawl(process.cwd())
    .sync()

  const additionalLinesToInject = []
  for (const matchedDir of result) {
    // Normalize slash
    const matchedSourceDir = '/' + matchedDir.replace(/\\/g, '/')
    // Get the matched groups value
    const matchedGroups = regex.exec(matchedSourceDir)
    // Iterate target segment, perform replacement for each segment
    // that contains * with the matched group value
    const targetBranchSegments = targetBranch.split('/')
    let replacementIndex = 1
    for (let j = 0; j < targetBranchSegments.length; j++) {
      if (targetBranchSegments[j].includes('*')) {
        targetBranchSegments[j] = targetBranchSegments[j].replace(
          /\*+/g,
          () => matchedGroups[replacementIndex++],
        )
      }
    }
    // Get new target branch and inject it
    const newTargetBranch = targetBranchSegments.join('/')
    additionalLinesToInject.push(`${matchedSourceDir} -> ${newTargetBranch}`)
    // TODO: detect abnormal mappings (e.g. inbalance or unsufficient *)
  }
  core.debug(
    `Injecting additional mappings:\n${additionalLinesToInject.join('\n')}`,
  )
  return additionalLinesToInject
}

/**
 * @param {string} sourceDir
 */
function createGlobalRegExp(sourceDir) {
  // Ensure starting and ending slash to easier match with fdir
  if (sourceDir[0] !== '/') sourceDir = '/' + sourceDir
  if (sourceDir[sourceDir.length - 1] !== '/') sourceDir += '/'

  const replaced = sourceDir
    .replace(/\*\*\//g, '(?:(.*)/)?')
    .replace(/\*\*/g, '(.*)')
    .replace(/\*/g, '([^/]+)')

  return new RegExp(`^${replaced}$`)
}

/**
 * @param {string} sourceDir
 * @param {string} cwd
 */
function getParentDirs(sourceDir, cwd) {
  if (sourceDir[0] === '/') {
    sourceDir = sourceDir.slice(1)
  }

  const segments = sourceDir.split('/')
  const firstStar = segments.findIndex((s) => s.includes('*'))
  segments.splice(firstStar)

  /** @type {string[]} */
  const parentDirs = []
  for (let i = 0; i < segments.length; i++) {
    parentDirs.push(path.join(cwd, segments.slice(0, i + 1).join('/'), '/'))
  }
  return parentDirs
}

/**
 * @param {string} str
 */
function blue(str) {
  return `\u001b[34m${str}\u001b[0m`
}

/**
 * @param {string} str
 */
function yellow(str) {
  return `\u001b[33m${str}\u001b[0m`
}

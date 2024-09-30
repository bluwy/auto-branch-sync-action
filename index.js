import fs from 'node:fs/promises'
import fss from 'node:fs'
import path from 'node:path'
import * as core from '@actions/core'
import { exec } from 'tinyexec'

const REPO_URL = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`

main()

async function main() {
  const mapLines = core.getMultilineInput('map', { required: true })
  const skipUnchangedCheck = core.getBooleanInput('skip-unchanged-check')
  const dryRun = core.getBooleanInput('dry-run')
  const ghToken = core.getInput('token')

  for (const line of mapLines) {
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

    if (skipUnchangedCheck) {
      core.debug('Skipping unchanged check')
    } else if (
      // skip if git branch exists and source directory has not changed
      !(await isGitBranchExists(targetBranch)) &&
      !(await hasGitChanged(sourceDir))
    ) {
      core.info(`Skipping "${sourceDir}" directory because it has not changed`)
      continue
    }

    core.info(`Syncing "${sourceDir}" directory to "${targetBranch}" branch`)
    await gitForcePush(sourceDir, targetBranch, dryRun, ghToken)
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
  const commitMessage = `"Sync from ${process.env.GITHUB_SHA}"`

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
git commit -am ${commitMessage}
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
git commit -m ${commitMessage}
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

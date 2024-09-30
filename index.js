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
    await gitForcePush(sourceDir, targetBranch, dryRun)
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
 */
async function gitForcePush(sourceDir, targetBranch, dryRun) {
  const sourcePath = path.join(process.cwd(), sourceDir)
  const o = {
    nodeOptions: { stdio: ['ignore', 'inherit', 'inherit'] },
    throwOnError: true,
  }

  core.debug(`Changing directory to "${sourcePath}"`)
  const originalCwd = process.cwd()
  process.chdir(sourcePath)

  const gitDir = path.join(sourcePath, '.git')

  // Re-use existing git if available (e.g. root)
  if (fss.existsSync(gitDir)) {
    core.debug(`Found existing git directory at "${gitDir}"`)
    core.debug(`Force pushing from to "${targetBranch}" branch`)
    if (dryRun) {
      core.info(`\
[dry run]
git checkout -d ${targetBranch}
git checkout --orphan ${targetBranch}
git config user.name github-actions[bot]
git config user.email 41898282+github-actions[bot]@users.noreply.github.com
git commit -am "Sync"
git push -f origin HEAD:${targetBranch}`)
    } else {
      await exec('git', ['checkout', '-d', targetBranch])
      await exec('git', ['checkout', '--orphan', targetBranch], o)
      await exec('git', ['config', 'user.name', 'github-actions[bot]'], o)
      // prettier-ignore
      await exec('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], o)
      await exec('git', ['commit', '-am', 'Sync'], o)
      await exec('git', ['push', '-f', 'origin', `HEAD:${targetBranch}`], o)
    }
  } else {
    core.debug(`Initializing git repository at "${sourcePath}"`)
    if (dryRun) {
      core.info(`\
[dry run]
git init
git commit -am "Sync"
git remote add origin ${REPO_URL}
git push -f origin HEAD:${targetBranch}`)
    } else {
      await exec('git', ['init'], o)
      await exec('git', ['config', 'user.name', 'github-actions[bot]'], o)
      // prettier-ignore
      await exec('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], o)
      await exec('git', ['commit', '-am', 'Sync'], o)
      await exec('git', ['remote', 'add', 'origin', REPO_URL], o)
      core.debug(`Force pushing from to "${targetBranch}" branch`)
      await exec('git', ['push', '-f', 'origin', `HEAD:${targetBranch}`], o)
      await fs.rm(gitDir, { recursive: true, force: true })
    }
  }

  core.debug(`Changing directory back to "${originalCwd}"`)
  process.chdir(originalCwd)
}

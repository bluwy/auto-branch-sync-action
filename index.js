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
      core.warning(`Invalid line: ${line}. First parameter is empty`)
      continue
    }

    targetBranch = targetBranch?.trim()
    if (!targetBranch) {
      core.warning(`Invalid line: ${line}. Second parameter is empty`)
      continue
    }

    if (skipUnchangedCheck) {
      core.debug('Skipping unchanged check')
    } else if (!(await hasGitChanged(sourceDir))) {
      core.info(`Skipping ${sourceDir} because it has not changed`)
      continue
    }

    core.info(`Syncing ${sourceDir} to ${targetBranch}`)
    await gitForcePush(sourceDir, targetBranch, dryRun)
  }
}

/**
 * @param {string} sourceDir
 */
async function hasGitChanged(sourceDir) {
  if (sourceDir[0] === '/') {
    sourceDir = sourceDir.slice(1)
  }

  const result = exec('git', [
    'diff',
    '--quiet',
    'HEAD',
    'HEAD~1',
    '--',
    sourceDir,
  ])

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

  core.debug(`Changing directory to ${sourcePath}`)
  const originalCwd = process.cwd()
  process.chdir(sourcePath)

  const gitDir = path.join(sourcePath, '.git')

  // Re-use existing git if available (e.g. root)
  if (fss.existsSync(gitDir)) {
    core.debug(`Found existing git directory at ${gitDir}`)
    core.debug(`Force pushing from to ${targetBranch}`)
    if (dryRun) {
      core.info(`[dry run] git push -f origin HEAD:${targetBranch}`)
    } else {
      await exec('git', ['push', '-f', 'origin', `HEAD:${targetBranch}`])
    }
  } else {
    core.debug(`Initializing git repository at ${sourcePath}`)
    if (dryRun) {
      core.info(`\
[dry run]
git init
git add .
git commit -m "Sync"
git remote add origin ${REPO_URL}
git push -f origin HEAD:${targetBranch}`)
    } else {
      await exec('git', ['init'])
      await exec('git', ['add', '.'])
      await exec('git', ['commit', '-m', 'Sync'])
      await exec('git', ['remote', 'add', 'origin', REPO_URL])
      core.debug(`Force pushing from to ${targetBranch}`)
      await exec('git', ['push', '-f', 'origin', `HEAD:${targetBranch}`])
      await fs.rm(gitDir, { recursive: true, force: true })
    }
  }

  core.debug(`Changing directory back to ${originalCwd}`)
  process.chdir(originalCwd)
}

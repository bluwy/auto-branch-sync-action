process.env.GITHUB_SERVER_URL = 'https://github.com'
process.env.GITHUB_REPOSITORY = 'bluwy/auto-branch-sync-action'
process.env.GITHUB_REF_NAME = 'master'
process.env.GITHUB_SHA = 'abc123'
process.env.INPUT_MAP = `
  / -> sync/root
  /test-fixtures -> sync/fixtures
  /test-fixtures/* -> sync/fixtures/* 
  /test-fixtures/**/nested -> sync/fixtures/**
`
process.env['INPUT_SKIP-UNCHANGED-CHECK'] = true
process.env['INPUT_DRY-RUN'] = true

await import('./index.js')

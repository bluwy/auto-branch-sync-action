# Auto Branch Sync

Automatically synchronize directories to other branches within the same repository.

Whenever the action is called with the given `map` configuration, it will force push the specified directories to the target branches. It will also check for changes against the previous commit to avoid unnecessary force pushes.

Usecases:

1. Syncing the `templates` directory to individual branches to allow quick cloning.
2. Syncing the `docs` directory to the `gh-pages` branch to update the website.

See the example below for more information.

## Example

In most cases, you only need the workflow below. Feel free to copy it and edit the `map` field to your needs.

```yaml
name: Sync

on:
  # Allow manually triggering the workflow (optional, but helpful)
  workflow_dispatch:
    inputs:
      skip-unchanged-check:
        type: boolean
        default: false
      dry-run:
        type: boolean
        default: false
  # Automatically trigger the workflow on push to the master branch
  push:
    branches:
      - master

# Enable write permission to allow force pushing changes to the repo
permissions:
  contents: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      # Checkout the repository to access the files
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2 # fetch 2 to compare with previous commit for changes

      # Run the action to synchronize the branches
      - uses: bluwy/auto-branch-sync-action@v1
        with:
          # example line-separated config:
          # 1. Maps the root of the repository to the `sync/root` branch
          # 2. Maps the `test-fixtures` directory to the `sync/fixtures` branch
          # 3. Maps the `test-fixtures/*` directory to the `sync/fixtures/*` branch
          #    (e.g. `test-fixtures/bar` -> `sync/fixtures/bar`)
          # 4. Maps the `test-fixtures/**/nested` directory to the `sync/fixtures-nested/**` branch
          #    (e.g. `test-fixtures/foo/nested` -> `sync/fixtures-nested/foo`)
          map: |
            / -> sync/root
            /test-fixtures -> sync/fixtures
            /test-fixtures/* -> sync/fixtures/* 
            /test-fixtures/**/nested -> sync/fixtures-nested/**
          # Optional: Skip the check for unchanged files (only recommended for debugging)
          skip-unchanged-check: ${{ inputs.skip-unchanged-check == true }}
          # Optional: Dry run to see the changes without apply any git actions (only recommended for debugging)
          dry-run: ${{ inputs.dry-run == true }}
```

## Possible enhancements

- Ignore certain directories from glob
- Specify a nested target directory in the target branch
- Specify a custom commit message, username, and email

Feel free to submit a PR if you need them!

## Sponsors

<p align="center">
  <a href="https://bjornlu.com/sponsor">
    <img src="https://bjornlu.com/sponsors.svg" alt="Sponsors" />
  </a>
</p>

## License

MIT

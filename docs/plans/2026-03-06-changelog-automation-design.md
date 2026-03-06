# Changelog Automation Design

**Date:** 2026-03-06

## Overview

Implement automated changelog generation and GitHub release management using git-cliff. This enables semi-automated releases where maintainers manually trigger version bumps via GitHub Actions, which then generates changelog, commits changes, creates tags, and publishes releases.

## Goals

- Automatically generate CHANGELOG.md from conventional commits
- Backfill changelog for all existing versions (v0.1 - v0.9)
- Enable manual release creation via GitHub Actions workflow_dispatch
- Maintain Keep a Changelog format
- Trigger existing deploy workflow on release publication

## Non-Goals

- Fully automated releases on every merge to master
- Commit message linting or enforcement
- Version bumping in package.json
- NPM package publishing

## Architecture

```
Manual workflow trigger (patch/minor/major)
    ↓
Generate changelog for all tags (v0.1...v0.10)
    ↓
Commit CHANGELOG.md to master
    ↓
Create Git tag (v0.10.0)
    ↓
Create GitHub Release with changelog body
    ↓
Triggers existing deploy workflow
```

### Components

1. **Configuration** (`cliff.toml`)
   - Conventional commit pattern mapping
   - Keep a Changelog template
   - GitHub repository integration

2. **Release Workflow** (`.github/workflows/release.yml`)
   - Manual trigger with bump type input
   - Changelog generation
   - Git commit and tag creation
   - GitHub release publication

3. **Package Scripts** (updated `package.json`)
   - `changelog:preview` - Local dry-run
   - `changelog:generate` - Local generation

4. **CHANGELOG.md**
   - Generated file following Keep a Changelog format
   - Versioned and committed to repository

## Changelog Format

Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

### Commit Type Mapping

| Commit Type | Changelog Section | Include |
| ----------- | ----------------- | ------- |
| `feat:`     | Added             | Yes     |
| `fix:`      | Fixed             | Yes     |
| `refactor:` | Changed           | Yes     |
| `perf:`     | Changed           | Yes     |
| `docs:`     | -                 | No      |
| `test:`     | -                 | No      |
| `chore:`    | -                 | No      |
| `ci:`       | -                 | No      |
| `style:`    | -                 | No      |

### Structure

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.0] - 2024-03-06

### Added

- New feature X (#45)

### Fixed

- Bug fix Y (#44)
```

### Links

- Compare links: `https://github.com/wKich/papai/compare/v0.9...v0.10`
- Commit links: `https://github.com/wKich/papai/commit/abc123`
- PR references: Parsed from merge commit messages

## Workflow Configuration

### Release Workflow (`.github/workflows/release.yml`)

```yaml
name: Release

on:
  workflow_dispatch:
    inputs:
      bump_type:
        description: 'Version bump type'
        required: true
        default: 'patch'
        type: choice
        options:
          - patch
          - minor
          - major

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install git-cliff
        run: bun add -g git-cliff

      - name: Configure Git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Generate CHANGELOG.md
        run: git-cliff -o CHANGELOG.md

      - name: Calculate next version
        id: version
        run: |
          CURRENT=$(git describe --tags --abbrev=0 | sed 's/^v//')
          case "${{ github.event.inputs.bump_type }}" in
            major)
              NEXT=$(echo $CURRENT | awk -F. '{print $1+1".0.0"}')
              ;;
            minor)
              NEXT=$(echo $CURRENT | awk -F. '{print $1"."$2+1".0"}')
              ;;
            patch)
              NEXT=$(echo $CURRENT | awk -F. '{print $1"."$2"."$3+1}')
              ;;
          esac
          echo "next=v$NEXT" >> $GITHUB_OUTPUT

      - name: Commit CHANGELOG.md
        run: |
          git add CHANGELOG.md
          git commit -m "chore(release): update changelog for ${{ steps.version.outputs.next }}"
          git push

      - name: Create Git tag
        run: |
          git tag ${{ steps.version.outputs.next }}
          git push origin ${{ steps.version.outputs.next }}

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          tag_name: ${{ steps.version.outputs.next }}
          name: Release ${{ steps.version.outputs.next }}
          body_path: RELEASE_NOTES.md
```

Note: A separate step should extract the current version's notes from CHANGELOG.md to RELEASE_NOTES.md for the release body.

### cliff.toml Configuration

Key settings:

- GitHub integration for wKich/papai
- Conventional commit parsers
- Keep a Changelog template
- Tag pattern: `v[0-9]*`

### Package.json Updates

```json
{
  "scripts": {
    "changelog:preview": "git-cliff --dry-run",
    "changelog:generate": "git-cliff -o CHANGELOG.md"
  }
}
```

## Error Handling

### Failure Scenarios

1. **Changelog generation fails**
   - Workflow exits before any changes
   - No tag created, no release published
   - Manual investigation needed

2. **Git commit/push fails**
   - Usually means branch protection or conflicts
   - Workflow fails before creating tag
   - Can retry manually

3. **Tag already exists**
   - Version bump calculation error
   - Workflow fails before release creation
   - Should check existence before creating

4. **GitHub release creation fails**
   - Most critical - tag exists but no release
   - Can create release manually from tag
   - Or delete tag and retry

### Safety Mechanisms

- Sequential operations: failure stops workflow
- Tag creation happens AFTER changelog commit
- Release creation is the final step
- Idempotent: re-running won't duplicate if version exists

## Testing Strategy

### Local Validation

1. **Install git-cliff**

   ```bash
   bun add -g git-cliff
   ```

2. **Preview changelog**

   ```bash
   bun run changelog:preview
   ```

   - Verify format looks correct
   - Check all v0.1-v0.9 tags are included
   - Confirm commit grouping is accurate

3. **Generate and review**
   ```bash
   bun run changelog:generate
   git diff CHANGELOG.md
   ```

   - Manually inspect 2-3 version sections
   - Verify compare links work
   - Check date formatting

### GitHub Workflow Testing

1. Create a test branch with workflow
2. Add `workflow_dispatch` trigger
3. Run workflow manually on branch
4. Review workflow logs for errors
5. Verify version calculation logic

### First Production Run

1. Choose `patch` for next version (v0.10.0)
2. Monitor workflow execution
3. Verify CHANGELOG.md committed correctly
4. Check release created with proper notes
5. Confirm existing deploy workflow triggered

## Historical Changelog

The first run will generate changelog for all existing tags:

- v0.1 through v0.9
- Commits parsed from beginning of repository history
- Each version section populated with relevant commits

## Dependencies

- **git-cliff**: Changelog generation tool
  - Install: `bun add -g git-cliff` or `cargo install git-cliff`
  - No runtime dependencies
  - Configuration via `cliff.toml`

## Alternatives Considered

### Alternative 1: conventional-changelog

- Node.js-based, heavier dependency tree
- More mature but less flexible templating
- Requires Node.js setup in GitHub Actions

### Alternative 2: GitHub Native

- Uses `generate_release_notes: true`
- Zero dependencies but limited customization
- Difficult to backfill historical versions
- Less control over CHANGELOG.md format

### Alternative 3: semantic-release

- Fully automated (not semi-automated)
- More complex configuration
- Overkill for this use case

## Open Questions

None. All decisions have been made:

- Tool: git-cliff
- Workflow: Semi-automated via GitHub Actions
- Format: Keep a Changelog
- History: Backfill all v0.1-v0.9

## References

- [git-cliff documentation](https://git-cliff.org/)
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

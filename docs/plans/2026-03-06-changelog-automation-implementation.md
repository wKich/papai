# Changelog Automation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement automated changelog generation and GitHub release management using git-cliff with semi-automated workflow dispatch

**Architecture:** Create git-cliff configuration, GitHub Actions workflow for manual release triggers, and package scripts for local preview/generation. Workflow generates changelog, commits to master, creates git tag, and publishes GitHub release with generated notes.

**Tech Stack:** git-cliff, GitHub Actions, Bun, conventional commits

---

## Prerequisites

- Read the design doc: `docs/plans/2026-03-06-changelog-automation-design.md`
- Review existing project structure and commit history
- Ensure you have git-cliff available for local testing

## Task 1: Install git-cliff Locally

**Files:**

- No files to modify

**Step 1: Install git-cliff globally**

```bash
bun add -g git-cliff
```

**Step 2: Verify installation**

```bash
git-cliff --version
```

Expected: Version number displayed (e.g., "git-cliff 2.x.x")

**Step 3: Test basic functionality**

```bash
cd /Users/ki/Projects/experiments/papai
git-cliff --dry-run
```

Expected: Changelog output in terminal (may be unformatted without config)

---

## Task 2: Create git-cliff Configuration

**Files:**

- Create: `cliff.toml`

**Step 1: Write cliff.toml configuration**

```toml
[changelog]
header = """
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

"""
body = """
{% if version %}\
    ## [{{ version | trim_start_matches(pat="v") }}] - {{ timestamp | date(format="%Y-%m-%d") }}
{% else %}\
    ## [Unreleased]
{% endif %}\
{% for group, commits in commits | group_by(attribute="group") %}
    ### {{ group | upper_first }}
    {% for commit in commits %}
        - {% if commit.scope %}**{{ commit.scope }}:** {% endif %}{{ commit.message | upper_first }}\
    {% endfor %}
{% endfor %}
"""
footer = """
{% for release in releases -%}
    {% if release.version -%}
        {% if release.previous.version -%}
            [{{ release.version | trim_start_matches(pat="v") }}]: \
                https://github.com/wKich/papai/compare/{{ release.previous.version }}...{{ release.version }}
        {% endif -%}
    {% else -%}
        [unreleased]: https://github.com/wKich/papai/compare/{{ release.previous.version }}...HEAD
    {% endif -%}
{% endfor %}
"""
trim = true

[git]
conventional_commits = true
filter_unconventional = true
split_commits = false
commit_parsers = [
    { message = "^feat", group = "Added" },
    { message = "^fix", group = "Fixed" },
    { message = "^doc", group = "Documentation" },
    { message = "^perf", group = "Changed" },
    { message = "^refactor", group = "Changed" },
    { message = "^style", group = "Styling" },
    { message = "^test", group = "Testing" },
    { message = "^chore\\(release\\)", skip = true },
    { message = "^chore", group = "Miscellaneous" },
]
filter_commits = false
tag_pattern = "v[0-9]*"
skip_tags = ""
ignore_tags = ""
topo_order = false
sort_commits = "oldest"

[github]
owner = "wKich"
repo = "papai"
```

**Step 2: Test configuration locally**

```bash
git-cliff --config cliff.toml --dry-run
```

Expected: Formatted changelog output with proper sections (Added, Fixed, Changed)

**Step 3: Generate CHANGELOG.md for verification**

```bash
git-cliff --config cliff.toml -o CHANGELOG.md
```

Expected: CHANGELOG.md file created with all versions (v0.1 through latest)

**Step 4: Review generated file**

```bash
cat CHANGELOG.md | head -100
```

Expected:

- Keep a Changelog header present
- Version sections properly formatted
- Compare links at bottom
- No duplicate entries

**Step 5: Commit cliff.toml**

```bash
git add cliff.toml
git commit -m "chore: add git-cliff configuration"
```

---

## Task 3: Create Release GitHub Actions Workflow

**Files:**

- Create: `.github/workflows/release.yml`

**Step 1: Write release workflow**

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

      - name: Calculate next version
        id: version
        run: |
          CURRENT=$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo "0.0.0")
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
          echo "next=v$NEXT" >> "$GITHUB_OUTPUT"
          echo "Calculated next version: v$NEXT"

      - name: Generate CHANGELOG.md
        run: git-cliff -o CHANGELOG.md

      - name: Commit CHANGELOG.md
        run: |
          git add CHANGELOG.md
          if git diff --cached --quiet; then
            echo "No changes to commit"
          else
            git commit -m "chore(release): update changelog for ${{ steps.version.outputs.next }}"
            git push
          fi

      - name: Create Git tag
        run: |
          if git rev-parse "${{ steps.version.outputs.next }}" >/dev/null 2>&1; then
            echo "Tag ${{ steps.version.outputs.next }} already exists"
          else
            git tag ${{ steps.version.outputs.next }}
            git push origin ${{ steps.version.outputs.next }}
          fi

      - name: Extract release notes
        run: |
          # Extract changelog section for this version
          VERSION="${{ steps.version.outputs.next }}"
          VERSION_NUM=$(echo "$VERSION" | sed 's/^v//')

          # Find the section for this version
          awk -v ver="## \"[$VERSION_NUM]\"" '
            $0 ~ ver {found=1; next}
            found && /^## \[/ {exit}
            found {print}
          ' CHANGELOG.md > RELEASE_NOTES.md

          echo "Release notes:"
          cat RELEASE_NOTES.md

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          tag_name: ${{ steps.version.outputs.next }}
          name: Release ${{ steps.version.outputs.next }}
          body_path: RELEASE_NOTES.md
          generate_release_notes: false
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Step 2: Validate YAML syntax**

```bash
cat .github/workflows/release.yml | head -20
```

Expected: Proper YAML indentation, no syntax errors visible

**Step 3: Commit workflow file**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow for automated changelog"
```

---

## Task 4: Add Package Scripts

**Files:**

- Modify: `package.json`

**Step 1: Add scripts to package.json**

Locate the `scripts` section and add two new entries:

```json
{
  "scripts": {
    "start": "bun run src/index.ts",
    "lint": "oxlint --type-aware .",
    "lint:fix": "oxlint --type-aware --fix .",
    "format": "oxfmt --write .",
    "format:check": "oxfmt --check .",
    "test": "bun test",
    "test:watch": "bun test --watch",
    "test:coverage": "bun test --coverage",
    "prepare": "[ -d .git ] && cp scripts/pre-commit.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit || true",
    "changelog:preview": "git-cliff --dry-run",
    "changelog:generate": "git-cliff -o CHANGELOG.md"
  }
}
```

**Step 2: Validate package.json syntax**

```bash
bun run format:check
```

Expected: No errors

**Step 3: Test new scripts locally**

```bash
bun run changelog:preview | head -50
```

Expected: Changelog preview output in terminal

**Step 4: Commit package.json changes**

```bash
git add package.json
git commit -m "chore: add changelog scripts to package.json"
```

---

## Task 5: Generate Initial CHANGELOG.md

**Files:**

- Create: `CHANGELOG.md`

**Step 1: Generate full changelog with all historical versions**

```bash
git-cliff -o CHANGELOG.md
```

**Step 2: Review generated changelog**

```bash
wc -l CHANGELOG.md
```

Expected: Non-zero line count (should contain all v0.1-v0.9 entries)

**Step 3: Verify format**

```bash
head -50 CHANGELOG.md
```

Expected:

- Keep a Changelog header
- v0.9.0 section with commits
- Proper grouping (Added, Fixed, Changed)

**Step 4: Check compare links**

```bash
tail -30 CHANGELOG.md
```

Expected: Markdown links like `[0.9.0]: https://github.com/wKich/papai/compare/v0.8...v0.9`

**Step 5: Commit CHANGELOG.md**

```bash
git add CHANGELOG.md
git commit -m "docs: generate initial changelog for v0.1-v0.9"
```

---

## Task 6: Test Workflow Locally

**Files:**

- No files to modify

**Step 1: Verify all files are committed**

```bash
git status
```

Expected: "nothing to commit, working tree clean"

**Step 2: Test dry-run locally**

```bash
git-cliff --dry-run --unreleased
```

Expected: Shows what would be added for next release (if any commits since last tag)

**Step 3: Test local script execution**

```bash
bun run changelog:preview
```

Expected: Same output as above

---

## Task 7: Lint and Format Check

**Files:**

- No files to modify

**Step 1: Run linter**

```bash
bun run lint
```

Expected: "Found 0 warnings and 0 errors"

**Step 2: Run format check**

```bash
bun run format:check
```

Expected: No errors

**Step 3: Fix any issues if needed**

If lint/format errors exist:

```bash
bun run lint:fix
bun run format
```

Then commit fixes:

```bash
git add -A
git commit -m "style: fix lint and format issues"
```

---

## Task 8: Create Documentation Update

**Files:**

- Modify: `README.md`

**Step 1: Add release section to README**

Locate an appropriate section (near Contributing or Development) and add:

```markdown
## Releasing

To create a new release:

1. Go to GitHub Actions → Release workflow
2. Click "Run workflow"
3. Select bump type (patch/minor/major)
4. The workflow will:
   - Generate changelog from conventional commits
   - Commit CHANGELOG.md
   - Create git tag
   - Publish GitHub release
   - Trigger deployment

### Local Development

Preview changelog without releasing:
\`\`\`bash
bun run changelog:preview
\`\`\`

Generate changelog locally:
\`\`\`bash
bun run changelog:generate
\`\`\`
```

**Step 2: Commit documentation**

```bash
git add README.md
git commit -m "docs: add release instructions to README"
```

---

## Task 9: Final Verification

**Files:**

- No files to modify

**Step 1: Review all changes**

```bash
git log --oneline -10
```

Expected: Clean commit history with:

- cliff.toml added
- release workflow added
- package.json updated
- CHANGELOG.md generated
- README.md updated

**Step 2: List all new/created files**

```bash
git diff --name-only HEAD~10..HEAD
```

Expected:

- cliff.toml
- .github/workflows/release.yml
- CHANGELOG.md
- package.json (modified)
- README.md (modified)

**Step 3: Verify workflow file is valid**

```bash
cat .github/workflows/release.yml | grep -E "^name:|^on:|^jobs:"
```

Expected: Valid YAML structure with name, on, and jobs sections

---

## Post-Implementation Testing

### Test 1: First Real Release (v0.10.0)

1. Merge implementation to master
2. Go to GitHub → Actions → Release
3. Click "Run workflow"
4. Select "patch" (creates v0.10.0)
5. Monitor execution
6. Verify:
   - CHANGELOG.md committed
   - Tag v0.10.0 created
   - Release published with notes
   - Deploy workflow triggered

### Test 2: Subsequent Release

1. Make a commit with `feat: add new feature`
2. Run workflow with "minor" bump
3. Verify:
   - New feature appears in Added section
   - Version incremented correctly (v0.11.0)
   - Previous entries preserved

### Test 3: Error Scenarios

1. Run workflow twice with same bump type
   - Should detect tag exists and skip
2. Delete CHANGELOG.md, run workflow
   - Should regenerate from scratch

---

## Summary

After completing all tasks, you will have:

1. **cliff.toml** - Git-cliff configuration with conventional commit mapping
2. **.github/workflows/release.yml** - Manual release workflow
3. **package.json** - Scripts for local changelog preview/generation
4. **CHANGELOG.md** - Full historical changelog (v0.1-v0.9)
5. **README.md** - Release instructions for maintainers

The implementation enables:

- Semi-automated releases via GitHub Actions
- Keep a Changelog format compliance
- Historical version backfill
- Local preview capability
- Integration with existing deploy workflow

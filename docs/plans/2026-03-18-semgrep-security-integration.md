# Semgrep Security Integration Design

> **For Claude:** REQUIRED SUB-SKILL: Use writing-plans to create implementation plan after this design is approved.

**Goal:** Integrate Semgrep static analysis for AI-generated code security and TypeScript best practices into the papai project's CI/CD pipeline and local development workflow.

**Architecture:** Hybrid approach combining AI-specific security rules (semgrep/ai-best-practices) with general TypeScript/JavaScript security rules, runnable both locally and in CI.

**Tech Stack:** Bun, TypeScript, Semgrep, GitHub Actions

---

## Overview

This design integrates Semgrep to provide automated security scanning for the papai Telegram bot. Given that papai heavily uses LLM integrations (Vercel AI SDK, OpenAI-compatible providers), we specifically include AI-specific security rules alongside general TypeScript security rules.

### Rules Included

| Ruleset                     | Purpose                             | Source           |
| --------------------------- | ----------------------------------- | ---------------- |
| `p/owasp-top-ten`           | General security vulnerabilities    | Semgrep Registry |
| `p/typescript`              | TypeScript best practices           | Semgrep Registry |
| `p/javascript`              | JavaScript security                 | Semgrep Registry |
| `semgrep/ai-best-practices` | AI/LLM-specific security (58 rules) | GitHub Clone     |

### Key Capabilities

- **Hardcoded API Keys**: Detects `sk-*`, `sk-ant-*`, `AIza*`, `hf_*` patterns
- **Prompt Injection**: Traces user input flowing into system prompts
- **Missing Safety Checks**: Validates error handling, refusal checks, moderation
- **Dangerous Execution**: Flags LLM output flowing to `eval()`/`exec()`

---

## Configuration Architecture

### Directory Structure

```
.semgrep/
├── config.yml          # Main Semgrep configuration
├── .semgrepignore      # Files to exclude from scanning
└── bin/                # Downloaded semgrep binary (gitignored)
```

### Configuration Files

**`.semgrep/config.yml`** - Main configuration:

```yaml
rules:
  # General security rules
  - config: p/owasp-top-ten
  - config: p/typescript
  - config: p/javascript

  # AI-specific rules (path provided at runtime)
  - config: ${SEMGREP_RULES}/

# Scan settings
scan:
  strict: true # Treat warnings as errors
  error: true # Non-zero exit on findings
  exclude:
    - tests/
    - node_modules/
    - .git/
    - dist/
    - '*.test.ts'
    - '*.spec.ts'
```

**`.semgrep/.semgrepignore`** - Exclusions:

```
# Test files
tests/
**/*.test.ts
**/*.spec.ts

# Dependencies
node_modules/
.git/

# Build artifacts
dist/
*.log

# Semgrep binary
.semgrep/bin/
```

### Scan Behavior

- **Strict Mode**: `--strict` flag treats warnings as errors (fails CI)
- **Error Mode**: `--error` flag ensures non-zero exit on findings
- **Output Formats**:
  - Local: Human-readable text
  - CI: JSON for parsing and SARIF for GitHub Security tab

---

## Local Development Integration

### New npm Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "security": "bun run scripts/run-semgrep.ts",
    "security:ci": "bun run scripts/run-semgrep.ts --ci"
  }
}
```

### Runner Script (`scripts/run-semgrep.ts`)

The script handles:

1. **Binary Management**:
   - Checks for `semgrep` in PATH
   - Downloads standalone binary (~50MB) to `.semgrep/bin/` if not found
   - Uses cached binary on subsequent runs

2. **Rule Acquisition**:
   - Clones `semgrep/ai-best-practices` repo to `/tmp/ai-best-practices`
   - Uses shallow clone (`--depth 1`) for speed

3. **Execution**:
   - Runs semgrep with configuration from `.semgrep/config.yml`
   - Supports `--ci` flag for JSON output
   - Supports `--fix` flag for auto-fixable issues

4. **Exit Codes**:
   - `0`: Clean scan
   - `1`: Findings detected
   - `2`: Execution error

### Developer Workflow

```bash
# Run security scan locally
bun run security

# Run with auto-fix (where applicable)
bun run security -- --fix

# CI-optimized output
bun run security --ci
```

### Pre-commit Hook Integration

Update `scripts/pre-commit.sh` to include security scan:

```bash
#!/bin/bash
# Run security scan before commit
echo "Running security scan..."
bun run security -- --error || {
    echo "Security issues found. Fix them before committing."
    exit 1
}
```

---

## CI/CD Integration

### New Job in `.github/workflows/ci.yml`

```yaml
security:
  name: Security Scan
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4

    - uses: oven-sh/setup-bun@v2
      with:
        bun-version: latest

    - name: Install dependencies
      run: bun install

    - name: Clone AI best practices rules
      run: |
        git clone --depth 1 https://github.com/semgrep/ai-best-practices.git /tmp/ai-best-practices

    - name: Run Semgrep security scan
      run: bun run security:ci
      env:
        SEMGREP_RULES: '/tmp/ai-best-practices/rules/'

    - name: Upload SARIF to GitHub Security tab
      uses: github/codeql-action/upload-sarif@v3
      if: always()
      with:
        sarif_file: semgrep-results.sarif
```

### CI Behavior

- **Parallel Execution**: Runs alongside existing jobs (format, lint, typecheck, test, e2e)
- **Failure Conditions**: Fails on any ERROR severity finding
- **Artifacts**: Preserves JSON output and SARIF files
- **GitHub Integration**: Uploads SARIF to GitHub Security tab for visualization

### Security Findings in PRs

- Findings appear in PR checks with links to rule documentation
- Suggested fixes shown where available
- Block merge on security failures (configurable in branch protection)

---

## Error Handling & False Positives

### Suppression Strategy

Use `# nosemgrep: <rule-id>` comments for intentional exceptions:

```typescript
// nosemgrep: openai-no-error-handling
// Intentional: Error handling is done at higher level in bot.ts
const response = await generateText({...})
```

### Documentation Requirements

All suppressions must include:

- Rule ID being suppressed
- Brief explanation of why it's safe
- Reference to where the handling actually occurs (if applicable)

### Review Process

- Review all suppressions quarterly
- Audit for patterns that suggest rule tuning needed
- Document common false positives in project wiki

### Logging Integration

Semgrep failures are logged via pino:

- Exit codes captured
- Finding counts by severity
- Rule IDs that triggered

---

## Implementation Phases

### Phase 1: Infrastructure

1. Create `.semgrep/` directory structure
2. Create `scripts/run-semgrep.ts` runner
3. Add npm scripts to `package.json`
4. Update `scripts/pre-commit.sh`

### Phase 2: CI Integration

1. Add security job to `.github/workflows/ci.yml`
2. Configure SARIF upload
3. Test with sample findings

### Phase 3: Tuning

1. Run full scan on codebase
2. Address or suppress findings
3. Document any permanent suppressions
4. Verify clean scan

---

## Success Criteria

- [ ] `bun run security` runs locally without errors
- [ ] `bun run security:ci` runs in GitHub Actions
- [ ] CI job fails on ERROR severity findings
- [ ] SARIF results upload to GitHub Security tab
- [ ] Pre-commit hook prevents commits with security issues
- [ ] Clean scan on existing codebase (after initial tuning)

---

## Maintenance

### Updating Rules

- AI best practices rules updated by re-cloning repo
- Registry rules auto-update (pulled at scan time)
- Pin to specific commit for reproducibility if needed

### Monitoring

- Track false positive rate
- Monitor scan duration (target: <30 seconds)
- Review new rule additions from semgrep/ai-best-practices

---

## References

- [Semgrep Documentation](https://semgrep.dev/docs/)
- [AI Best Practices Rules](https://github.com/semgrep/ai-best-practices)
- [Semgrep Registry](https://semgrep.dev/r)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

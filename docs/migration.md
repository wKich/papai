# Linear to Huly Migration

This document describes the migration process from Linear to Huly.

## Overview

The migration is designed to be **automatic and idempotent**. It runs on papai startup if not previously completed.

## How It Works

1. **Startup Check**: Papai checks `migration_status` table on startup
2. **Fetch from Linear**: Uses stored `linear_key` and `linear_team_id` to fetch issues
3. **Create in Huly**: Maps Linear issues to Huly format and creates them
4. **Track Progress**: Updates migration status in database

## Prerequisites

Users must have both Linear and Huly credentials configured:

- Linear: `linear_key`, `linear_team_id` (legacy, still in DB)
- Huly: `huly_email`, `huly_password`

## Running Migration

### Automatic (on startup)

```bash
bun run start
```

### Manual (standalone)

```bash
# Run migration
bun run migrate

# Reset and re-run
bun run migrate:reset
```

## Deployment Process

The CI/CD pipeline deploys in three stages:

1. **Deploy Huly** - Infrastructure and services
2. **Run Migration** - Data transfer (continues on failure)
3. **Deploy Papai** - Application with Huly support

## Troubleshooting

### Migration Failed

Check logs:

```bash
bun run migrate 2>&1 | grep -i error
```

Reset and retry:

```bash
bun run migrate:reset
```

### Partial Migration

Migration is idempotent - running it again will skip already-migrated users and retry failed ones.

## Post-Migration

After successful migration:

- Linear credentials can be removed from user configs
- `@linear/sdk` dependency can be removed (in future release)

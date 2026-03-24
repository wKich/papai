# Datetime Utility Review Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three issues found in code review of `src/utils/datetime.ts`: wrong `weekly` fallback, uncaught exception for empty-string timezone, and missing DST transition tests.

**Architecture:** All changes are confined to `src/utils/datetime.ts` and `tests/utils/datetime.test.ts`. No new files, no new dependencies.

**Tech Stack:** Bun, TypeScript, `date-fns-tz` (already installed).

---

## Pre-work: Understand the current state

Read before touching anything:

- `src/utils/datetime.ts` — the implementation (94 lines)
- `tests/utils/datetime.test.ts` — the existing tests (99 lines)

---

## Task 1: Fix `weekly` default and update test

**Problem:** `semanticScheduleToCron({ frequency: 'weekly', time: '09:00' })` currently returns `'0 9 * * *'` (daily — runs every day), not `'0 9 * * 1'` (Monday only). A caller selecting `weekly` intends once-per-week execution.

**Files:**

- Modify: `src/utils/datetime.ts:69`
- Modify: `tests/utils/datetime.test.ts:64-66`

### Step 1: Update the test to the correct expected value

In `tests/utils/datetime.test.ts`, find the test named `'weekly with no days_of_week defaults to every day'` (line 64). Change both its name and expected value:

```typescript
// BEFORE (line 64-66):
test('weekly with no days_of_week defaults to every day', () => {
  expect(semanticScheduleToCron({ frequency: 'weekly', time: '09:00' })).toBe('0 9 * * *')
})

// AFTER:
test('weekly with no days_of_week defaults to Monday', () => {
  expect(semanticScheduleToCron({ frequency: 'weekly', time: '09:00' })).toBe('0 9 * * 1')
})
```

### Step 2: Run the test to verify it fails

```bash
bun test tests/utils/datetime.test.ts
```

Expected: one failing test — `weekly with no days_of_week defaults to Monday` — because the implementation still returns `'0 9 * * *'`.

### Step 3: Fix the implementation

In `src/utils/datetime.ts`, find the `weekly` case (line 67-72):

```typescript
// BEFORE (line 68-69):
    case 'weekly': {
      const days = schedule.days_of_week
      if (days === undefined || days.length === 0) return `${m} ${h} * * *`

// AFTER:
    case 'weekly': {
      const days = schedule.days_of_week
      if (days === undefined || days.length === 0) return `${m} ${h} * * 1`
```

### Step 4: Run the tests to verify all pass

```bash
bun test tests/utils/datetime.test.ts
```

Expected: all tests pass.

### Step 5: Commit

```bash
git add src/utils/datetime.ts tests/utils/datetime.test.ts
git commit -m "fix(utils): weekly schedule without days now defaults to Monday"
```

---

## Task 2: Harden `localDatetimeToUtc` against thrown exceptions

**Problem:** `fromZonedTime(localStr, timezone)` throws a `RangeError` when `timezone` is an empty string (`""`). The current `Number.isNaN` guard only catches `NaN` return values; it does not catch thrown exceptions. If a user's stored timezone config is empty or corrupted, the bot will crash instead of falling back to UTC.

**Files:**

- Modify: `src/utils/datetime.ts:34-45`
- Modify: `tests/utils/datetime.test.ts` (add one test inside the `localDatetimeToUtc` describe block)

### Step 1: Write the failing test

Add this test at the end of the `localDatetimeToUtc` describe block in `tests/utils/datetime.test.ts`, after the existing `'falls back to treating time as UTC when timezone is invalid'` test:

```typescript
test('falls back to treating time as UTC when timezone is empty string', () => {
  expect(localDatetimeToUtc('2026-03-25', '09:00', '')).toBe('2026-03-25T09:00:00.000Z')
})
```

### Step 2: Run the test to verify it fails

```bash
bun test tests/utils/datetime.test.ts
```

Expected: one new failing test — either an uncaught `RangeError` or a wrong result. This confirms the bug exists.

### Step 3: Fix the implementation

Replace the body of `localDatetimeToUtc` in `src/utils/datetime.ts` to wrap `fromZonedTime` in a try/catch (handles both thrown exceptions and NaN results):

```typescript
export const localDatetimeToUtc = (date: string, time: string | undefined, timezone: string): string => {
  // fromZonedTime accepts "YYYY-MM-DDTHH:MM:SS" as a local datetime string
  const localStr = `${date}T${time ?? '00:00'}:00`
  try {
    const utcDate = fromZonedTime(localStr, timezone)
    if (Number.isNaN(utcDate.getTime())) {
      // Invalid timezone returned NaN — treat as UTC
      return new Date(`${localStr}Z`).toISOString()
    }
    return utcDate.toISOString()
  } catch {
    // Invalid timezone threw (e.g. empty string) — treat as UTC
    return new Date(`${localStr}Z`).toISOString()
  }
}
```

### Step 4: Run all tests to verify they pass

```bash
bun test tests/utils/datetime.test.ts
```

Expected: all tests pass, including the new one.

### Step 5: Commit

```bash
git add src/utils/datetime.ts tests/utils/datetime.test.ts
git commit -m "fix(utils): localDatetimeToUtc now handles empty-string timezone via try/catch"
```

---

## Task 3: Add DST transition tests

**Problem:** All existing tests use fixed-offset timezones (`Asia/Karachi`, no DST) or dates in known standard-time periods. There are no tests that verify DST offset changes are applied correctly, which is the most common category of timezone bug.

**Context:** In `America/New_York`, DST transitions happen in 2026:

- Spring forward: 2026-03-08 at 2:00 AM → jumps to 3:00 AM (EST UTC-5 → EDT UTC-4)
- Fall back: 2026-11-01 at 2:00 AM → falls back to 1:00 AM (EDT UTC-4 → EST UTC-5)

**Files:**

- Modify: `tests/utils/datetime.test.ts` (add tests inside the `localDatetimeToUtc` describe block)

### Step 1: Add DST offset-change tests

Add these tests at the end of the `localDatetimeToUtc` describe block, after the `'falls back to treating time as UTC when timezone is empty string'` test added in Task 2:

```typescript
test('applies correct standard-time offset (UTC-5) just before spring-forward', () => {
  // 2026-03-08 01:59 EST = UTC-5 → 06:59 UTC
  expect(localDatetimeToUtc('2026-03-08', '01:59', 'America/New_York')).toBe('2026-03-08T06:59:00.000Z')
})

test('applies correct daylight-time offset (UTC-4) just after spring-forward', () => {
  // 2026-03-08 03:00 EDT = UTC-4 → 07:00 UTC
  // (clocks jumped from 2:00 AM to 3:00 AM so 3:00 AM is the first valid EDT time)
  expect(localDatetimeToUtc('2026-03-08', '03:00', 'America/New_York')).toBe('2026-03-08T07:00:00.000Z')
})

test('applies correct daylight-time offset (UTC-4) in summer', () => {
  // America/New_York in summer is UTC-4
  // 2026-07-15 09:00 EDT = 13:00 UTC
  expect(localDatetimeToUtc('2026-07-15', '09:00', 'America/New_York')).toBe('2026-07-15T13:00:00.000Z')
})
```

### Step 2: Run the tests

```bash
bun test tests/utils/datetime.test.ts
```

Expected: all tests pass. These are correctness tests, not regression tests — if they fail, the `date-fns-tz` library is not handling DST correctly (would be a library bug, extremely unlikely).

If any test fails with an unexpected UTC value, do **not** change the test to match the wrong output. Instead, investigate whether:

1. The date arithmetic above has a mistake (re-verify the UTC offset for that date and time)
2. `date-fns-tz` is behaving unexpectedly (check its documentation for DST gap handling)

### Step 3: Commit

```bash
git add tests/utils/datetime.test.ts
git commit -m "test(utils): add DST transition tests for localDatetimeToUtc"
```

---

## Final verification

Run the full test suite to confirm no regressions:

```bash
bun test
```

Expected: all tests pass.

Then run the full check suite:

```bash
bun check:full
```

Expected: no errors.

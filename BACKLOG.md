# Bug Backlog

Open issues identified during the 2026-04-29 review. Bugs 1, 3, 5, and 7 from
the original list have been fixed; the rest are queued here for triage.

## High — likely user-visible

### B2 — `isFrustrated` misses contractions with apostrophes

- **Location:** `guardian/telegram.ts:31-34`
- The `FRUSTRATION_SIGNALS` list contains `"this doesnt work"` (no apostrophe)
  but not `"this doesn't work"`. A kid typing the natural form is not
  recognized as frustrated, so the conversation doesn't soften.
- **Fix:** Either add apostrophe variants to the list, or strip apostrophes
  from the lowered text before substring matching.

### B4 — `BUILD_HALLUCINATION_RE` fails on the most common phrasings

- **Location:** `guardian/telegram.ts:235`
- The trailing `\b` after `[!,. ]` makes the regex miss `"on it!"`,
  `"on it. Hold on"`, etc. — punctuation followed by `\W` has no word
  boundary, so the most natural sentence-final cases don't match.
- **Effect:** the hallucination guard fires far less often than intended;
  Claude can falsely claim a build is in progress without a `GAME_NAME:`
  token and the kid waits forever.
- **Fix:** drop the trailing `\b`, or replace it with `(?=$|\s)`.

## Medium — edge cases

### B6 — Job dedup window (30 min) > zombie threshold (10 min)

- **Location:** `guardian/builder.ts:199, 139`
- A re-confirm at minute 20 attaches to a job that's about to be requeued.
  The new poll starts with `zombieRequeued=false` and could re-requeue an
  already-requeued job.
- **Fix:** reduce `DEDUP_WINDOW_MS` to match `ZOMBIE_THRESHOLD_MS`, or carry
  the requeue flag forward when attaching.

### B8 — `pendingGameBuild` not reset on `start()`

- **Location:** `guardian/telegram.ts:333`
- `start()` clears `conversationHistory` but leaves `pendingGameBuild`. After
  a stop/start cycle with a stale pending build, the next confirmation-shaped
  message triggers the wrong build.
- **Fix:** add `pendingGameBuild = null` to the reset block.

### B9 — `walkDir` has no symlink-loop protection

- **Location:** `guardian/publisher.ts:185-196`
- A symlink in `assets/` pointing to a parent directory causes infinite
  recursion during publish.
- **Fix:** track visited real paths via `fs.realpathSync`, or skip symlinks.

### B10 — GitHub Pages config update silently swallows both failures

- **Location:** `guardian/publisher.ts:298-309`
- POST `/pages` then PUT `/pages` are both `try {} catch {}`. If both fail,
  publish reports `ok: true` but Pages may serve from the wrong branch — the
  kid gets a 404 URL.
- **Fix:** capture and surface the second error in `PublishResult`, or at
  minimum log it.

### B11 — `/api/setup/telegram-id` picks the first message regardless of sender

- **Location:** `guardian/api.ts:269-285`
- During setup, if anyone else messages the bot first, their ID is suggested
  for `KID_TELEGRAM_ID`.
- **Fix:** prompt the parent to confirm against the displayed name, or
  require a magic phrase ("setup") in the message.

## Low — cosmetic / hygiene

### B12 — `writeEnvAll` doesn't escape values

- **Location:** `guardian/config.ts:20-25`
- A value containing `\n`, `=`, or trailing whitespace silently corrupts the
  file. Practically fine for tokens/names; a paste accident could break it.
- **Fix:** wrap values with embedded special chars in single quotes, or
  reject invalid input at the API boundary.

### B13 — Job `claimedBy` field is inconsistent

- **Location:** `guardian/builder.ts:238-248`
- New jobs are written without `claimedBy`; the monitor sets it on pickup.
  UI/dashboard code has to handle both shapes.
- **Fix:** initialize `claimedBy: null` when writing a new job.

### B14 — `pollJobToCompletion` waits 4s before its first read

- **Location:** `guardian/builder.ts:152`
- Sleep happens at the top of the loop, so a job that completes in <4s gets
  an unnecessary delay.
- **Fix:** read first, then sleep.

### B15 — `detectLanIp`'s home-LAN preference is brittle

- **Location:** `guardian/config.ts:38-50`
- Hardcoded to `192.168.0/1.x`. Won't pick correctly on a `192.168.4.x`
  mesh router or on `10.x.x.x` networks. Edge case for current setup but
  fragile if the network changes.
- **Fix:** widen the preference to any RFC1918 range, or expose an override
  env var.

### B16 — `handleOpenClaude` only escapes single quotes

- **Location:** `guardian/api.ts:441-443`
- AppleScript would break if `playgroundDir` contained a `"`. macOS paths
  almost never do, but it's a sharp edge.
- **Fix:** also escape `"` and `\` for the AppleScript layer.

### B17 — DB and filesystem writes aren't transactional

- General. A crash mid-build can leave manifest updated but the kid never
  told. `recoverOrphanedJobs` covers Telegram delivery but not manifest /
  published.json consistency.
- **Fix:** none simple; document the failure modes or add a reconciliation
  pass on startup.

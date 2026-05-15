# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project is continuously deployed from `master` via Vercel and has no SemVer tags, so each section below corresponds to the pull request that shipped it.

## [#4] - 2026-05-15

### Added
- HMAC signature verification on incoming Sentry webhooks. When `SENTRY_CLIENT_SECRET` is set, the handler verifies `Sentry-Hook-Signature` (hex HMAC-SHA256 of the raw body) in constant time via WebCrypto. Invalid or missing signatures return `401` and aren't posted to Slack. Leaving the env var unset preserves the previous no-verification behavior.
- GitHub Actions workflow at `.github/workflows/test.yml` running `npm test` on every PR and push to `master` (Node 22).

## [#3] - 2026-05-15

### Added
- Comment webhook formatter — `:speech_balloon: {actor} commented on issue #{id} in {project}` with the comment body quoted and timestamp rendered via Slack's `<!date^…>` token. Covers `created` / `updated` / `deleted`.
- Metric-alert webhook formatter — title from `description_title` linked to `web_url`, body from `description_text`, and `alert_rule.aggregate` / `dataset` / `query` as section fields. Color and verb track `action`: green for `resolved`, red for `critical`, yellow for `warning`.

### Changed
- `installation` webhooks (integration install / uninstall lifecycle) are silently 200'd instead of producing yellow debug noise — they aren't actionable alerts.

## [#2] - 2026-05-15

### Added
- Action-aware issue rendering. Resolved, reopened, assigned, archived, and ignored events each get their own emoji, verb, and color instead of always rendering as a red error.
- Colored attachment bar on every message, derived from the action or from the issue level (fatal / error / warning / info / debug) when no action is set.
- Extra issue metadata surfaced when present: `shortId` (as a context line), `priority`, `substatus`, event `count`, affected `userCount`, and `firstSeen` / `lastSeen` rendered via `<!date^…>` so timestamps land in the viewer's local timezone.
- Top-level `text` fallback on every Slack payload so notifications and screen readers have something to show when blocks can't render.
- Graceful fallback for unknown webhook shapes. Anything not in the formatter table posts a yellow Slack card naming the detected resource type with the raw JSON, so new payload shapes are visible rather than silently dropped. The type is read from `Sentry-Hook-Resource` when present, with payload-shape inference as a fallback.
- Top-level try/catch around the handler — invalid JSON, render exceptions, and Slack `ok:false` responses all surface as a debug message in Slack rather than a silent 5xx.
- Test suite using Node's built-in `node:test` runner (no extra deps). Anchored to Sentry's documented payload shapes (`test/fixtures/sentry.js`) and Slack's Block Kit schema (`test/slack-schema.js`); each documented enum is iterated so a new value reveals whichever branch is missing.

### Changed
- Switched the package to ESM (`"type": "module"`). The unused legacy CommonJS file was renamed to `sendMessage.cjs` to keep it parseable.
- Webhook parsing extracted into `parsePayload(body)` so new payload shapes can be added without touching the request handler.
- Missing fields (no assigned user, no event count, etc.) are now omitted rather than rendered as "Unknown User" / `0`.

## [#1] - 2026-05-15

### Changed
- Title in Slack messages now links to the Sentry issue via `issue.permalink`.
- Project name reads `issue.project.slug || issue.project.name`; message body reads `metadata.value`; level reads `issue.level` so error issues are correctly flagged.
- Culprit is rendered as inline code instead of being mislabeled `*Message:*`.

### Fixed
- Slack alerts arriving blank ("Unknown Project", "No message provided", "Unknown Culprit", level `info`) for Sentry integration webhooks. The handler was reading from `body.data.event`, but integration webhooks deliver the alert at `body.data.issue`. The extractor now reads `data.issue` first and falls back to `data.event` for the older event-alert payload shape.

[#4]: https://github.com/InsightStack/sentry-to-slack/pull/4
[#3]: https://github.com/InsightStack/sentry-to-slack/pull/3
[#2]: https://github.com/InsightStack/sentry-to-slack/pull/2
[#1]: https://github.com/InsightStack/sentry-to-slack/pull/1

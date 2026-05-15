# Changelog

## Unreleased

### Added
- Test suite using Node's built-in `node:test` runner (no extra dependencies). Covers `parsePayload`, `pickColor`, and `buildBlocks` against integration-webhook, event-alert, and empty-body fixtures. Run with `npm test`.
- Switched the package to ESM (`"type": "module"`) so the test runner can `import` from `api/edge.js`. The unused legacy CommonJS file `sendMessage.js` was renamed to `sendMessage.cjs` to keep it parseable.
- Action-aware rendering for Sentry issue webhooks. Resolved, reopened, assigned, archived, and ignored events now get their own emoji, verb, and color instead of always rendering as a red error alert.
- Colored attachment bar on every message. Color is derived from the action (green for resolved, gray for archived/ignored, etc.) or from the issue level (fatal/error/warning/info/debug) when no action is set.
- Surfaced extra issue metadata when present: `shortId` (as a context line alongside project/environment), `priority`, `substatus`, event `count`, affected `userCount`, and `firstSeen` / `lastSeen` rendered via Slack's `<!date^…>` formatter so timestamps land in the viewer's local timezone.
- Top-level `text` fallback on the Slack payload so notifications and screen readers have something to show when blocks can't render.

### Changed
- Webhook parsing is now extracted into a `parsePayload(body)` helper so additional Sentry payload shapes (event alerts, metric alerts, comments) can be added without touching the request handler.
- Fields that aren't present in the payload (e.g. no assigned user, no event count) are now omitted rather than rendered as "Unknown User" / `0`.

### Fixed
- Slack alerts were arriving blank ("Unknown Project", "No message provided", "Unknown Culprit", level `info`) for Sentry integration webhooks. The handler was reading from `body.data.event`, but integration webhooks deliver the alert at `body.data.issue`. The extractor now reads from `data.issue` first and falls back to `data.event` for the older event-alert payload shape.

### Changed
- Title in Slack messages now links to the Sentry issue via `issue.permalink`.
- Project is taken from `issue.project.slug || issue.project.name`; message body from `metadata.value`; level from `issue.level` so error issues are correctly flagged.
- Culprit is rendered as inline code and no longer shares the `*Message:*` label.

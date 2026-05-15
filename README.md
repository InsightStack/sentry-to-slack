# Sentry to Slack

A tiny Vercel Edge Function that turns Sentry webhooks into nicely-formatted Slack messages. Free alternative to Sentry's paid Slack integration — bring your own Slack app and your own free Vercel project.

- ~1 file of handler code (`api/edge.js`)
- Verifies Sentry's HMAC signature
- Action-aware rendering (resolved / reopened / assigned / archived / ignored)
- Formatters for **issues**, **event alerts**, **comments**, and **metric alerts**
- Yellow-bar fallback message for unknown payloads so nothing silently disappears

## What it looks like

Each Sentry event becomes a Slack message with:

- A header that links to the Sentry issue, prefixed with an emoji that reflects the action (🚨 reopened, ✅ resolved, 👤 assigned, 🗄️ archived, 🔇 ignored) or the issue level (💀 fatal, 🔴 error, ⚠️ warning, ℹ️ info, 🪲 debug).
- A context line with the issue short ID, project, and environment.
- Fields for level, priority, status, event count, affected user count, first seen, last seen, and the impacted user — only the ones that are actually present in the payload.
- The message body and culprit, rendered as inline code where appropriate.
- A colored attachment bar matching the action or level.
- A top-level `text` fallback so notifications and screen readers always have something.

Comment webhooks render as `:speech_balloon: {actor} commented on issue #{id} in {project}` with the comment body quoted. Metric alerts render with the alert rule's aggregate, dataset, and query.

## Use cases

- Indie projects and small teams that don't want to pay for Sentry's official Slack integration.
- Self-hosted Sentry deployments that need a lightweight bridge to Slack.
- Anyone who wants more control over the Slack message format than the built-in integration offers — fork it and edit `api/edge.js`.
- Routing different Sentry projects to different Slack channels (deploy the function more than once with different `CHANNEL_ID`s).

## Deploy to Vercel

1. **Fork or clone this repo** to your own GitHub account.
2. **Import it into Vercel.** From [vercel.com/new](https://vercel.com/new), pick the repo and accept the defaults. Vercel auto-detects this as a project with an Edge Function at `api/edge.js`; no build step or framework preset is needed.
3. **Set environment variables** (Project → Settings → Environment Variables):
   - `SLACK_ACCESS_TOKEN` — bot token from your Slack app's OAuth page (starts with `xoxb-`).
   - `CHANNEL_ID` — the Slack channel ID (e.g. `C01234ABCDE`) to post to.
   - `SENTRY_CLIENT_SECRET` — the Client Secret from your Sentry integration. When set, the function verifies the `Sentry-Hook-Signature` HMAC on every request and rejects anything that doesn't match. Strongly recommended — without it, anyone who knows your function URL can post fake alerts to your Slack channel.
4. **Deploy.** Vercel gives you a URL like `https://your-project.vercel.app/api/edge`. That's your webhook endpoint.

Re-deploy after any env var change so the new value is picked up.

## Set up Slack

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and **Create New App** → **From scratch**. Pick your workspace.
2. Under **OAuth & Permissions**, add the `chat:write` bot token scope.
3. **Install to Workspace** and copy the **Bot User OAuth Token** (starts with `xoxb-`). This is your `SLACK_ACCESS_TOKEN`.
4. Invite the bot to the channel you want alerts in: `/invite @your-bot-name` in Slack.
5. Get the channel ID — in Slack, right-click the channel → **View channel details** → scroll to the bottom. This is your `CHANNEL_ID`.

## Set up Sentry

Sentry has two ways to send webhooks. The recommended path is an **Internal Integration** because it signs requests with HMAC, which the function verifies when `SENTRY_CLIENT_SECRET` is set.

### Internal Integration (recommended)

1. In Sentry, go to **Settings → Custom Integrations → Create New Integration → Internal Integration**.
2. Name it (e.g. `Slack relay`), set **Webhook URL** to your Vercel function URL (`https://your-project.vercel.app/api/edge`).
3. Under **Webhooks**, enable the resources you care about — typically **Issue** and **Comment**, plus **Metric Alert** if you use Sentry metric alerts.
4. Save. Sentry will show a **Client Secret** — copy it into Vercel as `SENTRY_CLIENT_SECRET`.
5. Open an alert rule (or create one) under **Alerts** and add an action that sends a notification via the integration you just created.

### Legacy webhook (no signature verification)

If you can't create an internal integration, use **Project Settings → Legacy Integrations → WebHooks**, add your Vercel function URL, and skip `SENTRY_CLIENT_SECRET`. The function will still work, but it won't verify the request came from Sentry.

## Testing

Trigger an error in your Sentry-instrumented app and watch your Slack channel. The function also logs the raw Sentry payload to Vercel's function logs — handy when debugging payload shapes.

Locally:

```bash
npm install
npm test
```

The test suite uses Node's built-in `node:test` runner (no extra deps) and validates outgoing Slack payloads against the Block Kit spec. Tests run in CI on every PR via `.github/workflows/test.yml`.

### Trigger it manually with curl

You can post a fake Sentry payload at your deployed function to confirm the wiring end-to-end. Replace `your-project.vercel.app` with your Vercel URL.

If `SENTRY_CLIENT_SECRET` is **not** set on the deployment, a plain POST is enough:

```bash
curl -X POST https://your-project.vercel.app/api/edge \
  -H 'Content-Type: application/json' \
  -H 'Sentry-Hook-Resource: issue' \
  -d '{
    "action": "created",
    "data": {
      "issue": {
        "title": "Test alert from curl",
        "level": "error",
        "shortId": "TEST-1",
        "project": { "slug": "demo" },
        "environment": "production",
        "permalink": "https://sentry.io/organizations/demo/issues/0/",
        "metadata": { "title": "Test alert from curl", "value": "Hello from curl" },
        "culprit": "curl/manual-test"
      }
    }
  }'
```

If `SENTRY_CLIENT_SECRET` **is** set, the request needs a valid `Sentry-Hook-Signature` header (hex HMAC-SHA256 of the raw body using your client secret). Easiest from a shell:

```bash
SECRET='your-sentry-client-secret'
BODY='{"action":"created","data":{"issue":{"title":"Test alert from curl","level":"error","project":{"slug":"demo"},"environment":"production","metadata":{"title":"Test alert from curl","value":"Hello from curl"}}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}')

curl -X POST https://your-project.vercel.app/api/edge \
  -H 'Content-Type: application/json' \
  -H 'Sentry-Hook-Resource: issue' \
  -H "Sentry-Hook-Signature: $SIG" \
  -d "$BODY"
```

Important: the signature is computed over the **exact bytes** of the request body. If you change `BODY` (even adding a space), regenerate `SIG`. A mismatch returns `401` and nothing is posted to Slack.

To test the unknown-payload fallback, send a body the function doesn't have a formatter for — e.g. `-H 'Sentry-Hook-Resource: surprise'` with any JSON. You should see a yellow debug card appear in Slack with the raw payload.

## Webhook resources supported

| `Sentry-Hook-Resource` | Behavior |
| --- | --- |
| `issue` | Full alert with action-aware emoji, color, fields, and message body. |
| `event_alert` | Same renderer as `issue`. |
| `comment` | Quoted comment body + actor + issue ref. |
| `metric_alert` | Title, description, and alert rule aggregate/dataset/query. |
| `installation` | Silently 200'd (integration lifecycle, not alert noise). |
| anything else | Yellow-bar fallback message in Slack with the raw payload, so nothing disappears. |

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `SLACK_ACCESS_TOKEN` | yes | Bot token used to call `chat.postMessage`. |
| `CHANNEL_ID` | yes | Channel the bot posts into. |
| `SENTRY_CLIENT_SECRET` | recommended | Enables HMAC verification of incoming webhooks. |

## License

MIT.

## Credits

- Originally forked from [Lutif/sentry-to-slack](https://github.com/Lutif/sentry-to-slack) — the original Vercel-edge-function-to-Slack idea and starter code.
- Maintained and rewritten by [James Van Dyke (@jvandyke)](https://github.com/jvandyke).

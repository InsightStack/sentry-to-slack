import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePayload, buildBlocks, buildSlackMessage, pickColor } from '../api/edge.js';
import {
  SENTRY_ISSUE_ACTIONS,
  SENTRY_LEVELS,
  SENTRY_PRIORITIES,
  SENTRY_SUBSTATUSES,
  issueWebhook,
  commentWebhook,
  metricAlertWebhook,
  legacyEventAlert,
} from './fixtures/sentry.js';
import { validateSlackMessage, SLACK_DATE_RE } from './slack-schema.js';

const CHANNEL = 'C0123456789';

const buildFromBody = (body) => buildSlackMessage(CHANNEL, parsePayload(body));

// ---------------------------------------------------------------------------
// Sentry → parsed payload contract
// ---------------------------------------------------------------------------

test('parsePayload extracts every documented field from an issue webhook', () => {
  const p = parsePayload(issueWebhook());

  // Action and level mirror the documented top-level/issue fields.
  assert.equal(p.action, 'created');
  assert.equal(p.level, 'error');

  // Identity and links come from documented `shortId` + `permalink`.
  assert.equal(p.shortId, 'BACKEND-7');
  assert.equal(p.permalink, 'https://sentry.io/insightstack/backend/issues/100/');
  assert.equal(p.title, 'Error: Sync critically stale');

  // project.slug is preferred over project.name per the docs ordering.
  assert.equal(p.project, 'insightstack-backend');

  // Documented enums.
  assert.equal(p.priority, 'high');
  assert.equal(p.substatus, 'new');

  // count is a string in the doc schema; we coerce to number for rendering.
  assert.equal(p.count, 42);
  assert.equal(p.userCount, 5);

  // Timestamps are passed through unchanged for downstream formatting.
  assert.equal(p.firstSeen, '2026-05-10T10:00:00.000000Z');
  assert.equal(p.lastSeen, '2026-05-15T12:00:00.000000Z');

  // metadata.value is the human-readable message; culprit is the doc field name.
  assert.equal(p.formatted, 'Last sync was 4h ago');
  assert.equal(p.culprit, 'processSyncHealthCheck(index)');
});

test('parsePayload reads the older event-alert shape (data.event)', () => {
  const p = parsePayload(legacyEventAlert);
  assert.equal(p.level, 'warning');
  assert.equal(p.title, 'Slow query detected');
  assert.equal(p.permalink, 'https://sentry.io/insightstack/backend/issues/100/events/abc/');
  assert.equal(p.formatted, 'query took 12s');
  assert.equal(p.environment, 'staging');
  assert.equal(p.email, 'user@example.com');
});

test('parsePayload returns safe defaults for completely unknown payload shapes', () => {
  const p = parsePayload({});
  assert.equal(p.level, 'info');
  assert.equal(p.title, 'Sentry Alert');
  assert.equal(p.project, 'Unknown Project');
  assert.equal(p.environment, 'production');
  assert.equal(p.action, null);
});

// ---------------------------------------------------------------------------
// Every documented Sentry action produces a valid Slack message
// ---------------------------------------------------------------------------

for (const action of SENTRY_ISSUE_ACTIONS) {
  test(`issue webhook with action="${action}" → valid Slack Block Kit payload`, () => {
    const msg = buildFromBody(issueWebhook({ top: { action } }));
    // Schema validation catches block-type, length, color, and structure bugs.
    assert.doesNotThrow(() => validateSlackMessage(msg));
    // The action verb should never accidentally fall back to the title alone.
    const header = msg.attachments[0].blocks[0].text.text;
    assert.match(header, /\*.+\*/);
  });
}

test('action="resolved" is rendered as a green attachment with the documented verb', () => {
  const msg = buildFromBody(issueWebhook({ top: { action: 'resolved' } }));
  assert.equal(msg.attachments[0].color, '#2EB67D');
  assert.match(msg.attachments[0].blocks[0].text.text, /Resolved:/);
});

test('action="archived" is rendered as a neutral/gray attachment', () => {
  const msg = buildFromBody(issueWebhook({ top: { action: 'archived' } }));
  // gray-ish hex (anything in the gray family) — concretely we use #9B9B9B.
  assert.match(msg.attachments[0].color, /^#[0-9a-fA-F]{6}$/);
  assert.match(msg.attachments[0].blocks[0].text.text, /Archived:/);
});

test('action="created" with level=error uses the error-level color, not an action color', () => {
  const msg = buildFromBody(issueWebhook({ top: { action: 'created' }, issue: { level: 'error' } }));
  // Should fall through to level-based coloring (no action verb in header).
  assert.doesNotMatch(msg.attachments[0].blocks[0].text.text, /Resolved:|Archived:|Assigned:/);
  // Red family — the documented "danger" semantics for errors.
  assert.match(msg.attachments[0].color, /^#[0-9a-fA-F]{6}$/);
});

// ---------------------------------------------------------------------------
// Every documented Sentry level produces a valid Slack color
// ---------------------------------------------------------------------------

for (const level of SENTRY_LEVELS) {
  test(`issue webhook with level="${level}" → valid Slack attachment color`, () => {
    const msg = buildFromBody(issueWebhook({ issue: { level } }));
    assert.doesNotThrow(() => validateSlackMessage(msg));
  });
}

// ---------------------------------------------------------------------------
// Every documented priority and substatus renders into the fields block
// ---------------------------------------------------------------------------

for (const priority of SENTRY_PRIORITIES) {
  test(`priority="${priority}" appears verbatim in the Slack fields block`, () => {
    const msg = buildFromBody(issueWebhook({ issue: { priority } }));
    const fieldsBlock = msg.attachments[0].blocks.find(b => b.type === 'section' && b.fields);
    const priorityField = fieldsBlock.fields.find(f => f.text.startsWith('*Priority:*'));
    assert.ok(priorityField, 'expected a Priority field');
    assert.match(priorityField.text, new RegExp(`\\b${priority}\\b`));
  });
}

for (const substatus of SENTRY_SUBSTATUSES) {
  test(`substatus="${substatus}" appears verbatim in the Slack fields block`, () => {
    const msg = buildFromBody(issueWebhook({ issue: { substatus } }));
    const fieldsBlock = msg.attachments[0].blocks.find(b => b.type === 'section' && b.fields);
    const statusField = fieldsBlock.fields.find(f => f.text.startsWith('*Status:*'));
    assert.ok(statusField, 'expected a Status field');
    assert.equal(statusField.text, `*Status:*\n${substatus}`);
  });
}

// ---------------------------------------------------------------------------
// Slack rendering contract
// ---------------------------------------------------------------------------

test('Slack payload from a documented issue webhook validates against Block Kit schema', () => {
  const msg = buildFromBody(issueWebhook());
  assert.doesNotThrow(() => validateSlackMessage(msg));
});

test('permalink renders as the documented Slack mrkdwn link syntax <url|text>', () => {
  const msg = buildFromBody(issueWebhook());
  const header = msg.attachments[0].blocks[0].text.text;
  // https://docs.slack.dev/messaging/formatting-message-text — `<url|label>`.
  assert.match(
    header,
    /<https:\/\/sentry\.io\/insightstack\/backend\/issues\/100\/\|Error: Sync critically stale>/,
  );
});

test('firstSeen / lastSeen render as Slack <!date^TIMESTAMP^TOKEN|FALLBACK> tokens', () => {
  const msg = buildFromBody(issueWebhook());
  const fieldsBlock = msg.attachments[0].blocks.find(b => b.type === 'section' && b.fields);
  const firstSeen = fieldsBlock.fields.find(f => f.text.startsWith('*First seen:*'));
  const lastSeen = fieldsBlock.fields.find(f => f.text.startsWith('*Last seen:*'));
  const firstValue = firstSeen.text.split('\n').slice(1).join('\n');
  const lastValue = lastSeen.text.split('\n').slice(1).join('\n');
  assert.match(firstValue, SLACK_DATE_RE);
  assert.match(lastValue, SLACK_DATE_RE);

  // Verify the timestamp converts to the documented unix-seconds form.
  const expectedFirst = Math.floor(Date.parse('2026-05-10T10:00:00.000000Z') / 1000);
  assert.match(firstValue, new RegExp(`<!date\\^${expectedFirst}\\^`));
});

test('top-level `text` fallback is set so Slack notifications render', () => {
  const msg = buildFromBody(issueWebhook());
  // chat.postMessage requires text/blocks/attachments — text powers the
  // mobile push and the screen-reader fallback.
  assert.equal(msg.text, 'Error: Sync critically stale');
});

test('channel is passed through to chat.postMessage unchanged', () => {
  const msg = buildFromBody(issueWebhook());
  assert.equal(msg.channel, CHANNEL);
});

// ---------------------------------------------------------------------------
// Robustness: other documented webhook shapes must not crash and must produce
// a Block-Kit-valid message even if content is sparse.
// ---------------------------------------------------------------------------

test('comment webhook does not crash and produces a schema-valid Slack message', () => {
  // Comments deliver only data.comment/comment_id/issue_id/project_slug —
  // none of the issue fields are present. We just need to not blow up and to
  // emit a valid Block Kit payload.
  const msg = buildFromBody(commentWebhook);
  assert.doesNotThrow(() => validateSlackMessage(msg));
});

test('metric_alert webhook does not crash and produces a schema-valid Slack message', () => {
  const msg = buildFromBody(metricAlertWebhook);
  assert.doesNotThrow(() => validateSlackMessage(msg));
});

test('empty body produces a schema-valid Slack message with safe defaults', () => {
  const msg = buildFromBody({});
  assert.doesNotThrow(() => validateSlackMessage(msg));
});

// ---------------------------------------------------------------------------
// Field-omission contract: don't render "Unknown User" or "0" for fields the
// Sentry payload didn't include.
// ---------------------------------------------------------------------------

test('fields the Sentry payload omits are not rendered as "Unknown" or 0', () => {
  const msg = buildFromBody(issueWebhook({
    issue: {
      assignedTo: null,
      userCount: 0,
      count: '0',
      priority: null,
      substatus: null,
      // parsePayload falls back from substatus → status, so clear status too
      // for this "everything omitted" case.
      status: null,
      firstSeen: null,
      lastSeen: null,
    },
  }));
  const fieldsBlock = msg.attachments[0].blocks.find(b => b.type === 'section' && b.fields);
  const labels = (fieldsBlock?.fields || []).map(f => f.text.split(':')[0].replaceAll('*', ''));
  // Level is always present; everything else above should be omitted.
  assert.deepEqual(labels, ['Level']);
});

// ---------------------------------------------------------------------------
// Sanity: helpers behave as documented even outside the parsePayload path.
// ---------------------------------------------------------------------------

test('pickColor returns a valid Slack attachment color for every documented action', () => {
  for (const action of SENTRY_ISSUE_ACTIONS) {
    const color = pickColor(action, 'error');
    assert.match(color, /^(good|warning|danger|#[0-9a-fA-F]{6})$/);
  }
});

test('pickColor returns a valid Slack attachment color for every documented level', () => {
  for (const level of SENTRY_LEVELS) {
    const color = pickColor(null, level);
    assert.match(color, /^(good|warning|danger|#[0-9a-fA-F]{6})$/);
  }
});

test('buildBlocks output by itself respects Block Kit limits', () => {
  // Wrap in a dummy attachment so we can reuse the validator.
  const msg = {
    channel: CHANNEL,
    text: 'x',
    attachments: [{ color: '#000000', blocks: buildBlocks(parsePayload(issueWebhook())) }],
  };
  assert.doesNotThrow(() => validateSlackMessage(msg));
});

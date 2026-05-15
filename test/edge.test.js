import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePayload, buildBlocks, pickColor } from '../api/edge.js';

const integrationWebhook = {
  action: 'created',
  data: {
    issue: {
      level: 'error',
      title: 'Error: Sync critically stale',
      culprit: 'processSyncHealthCheck(index)',
      permalink: 'https://sentry.io/organizations/x/issues/123/',
      shortId: 'INSIGHTSTACK-BACKEND-7',
      priority: 'high',
      substatus: 'new',
      count: '42',
      userCount: 5,
      firstSeen: '2026-05-10T10:00:00Z',
      lastSeen: '2026-05-15T12:00:00Z',
      environment: 'production',
      project: { slug: 'insightstack-backend', name: 'InsightStack Backend' },
      metadata: { title: 'Error: Sync critically stale', value: 'Last sync was 4h ago' },
      assignedTo: { email: 'oncall@example.com' },
    },
  },
};

const eventAlertWebhook = {
  data: {
    event: {
      level: 'warning',
      title: 'Slow query detected',
      culprit: 'pg.query',
      web_url: 'https://sentry.io/.../events/abc/',
      logentry: { formatted: 'query took 12s' },
      project_slug: 'api',
      environment: 'staging',
      user: { email: 'user@example.com' },
    },
    project_name: 'api',
  },
};

test('parsePayload reads Sentry integration webhooks from data.issue', () => {
  const p = parsePayload(integrationWebhook);
  assert.equal(p.level, 'error');
  assert.equal(p.title, 'Error: Sync critically stale');
  assert.equal(p.project, 'insightstack-backend');
  assert.equal(p.environment, 'production');
  assert.equal(p.shortId, 'INSIGHTSTACK-BACKEND-7');
  assert.equal(p.priority, 'high');
  assert.equal(p.substatus, 'new');
  assert.equal(p.count, 42);
  assert.equal(p.userCount, 5);
  assert.equal(p.firstSeen, '2026-05-10T10:00:00Z');
  assert.equal(p.lastSeen, '2026-05-15T12:00:00Z');
  assert.equal(p.formatted, 'Last sync was 4h ago');
  assert.equal(p.culprit, 'processSyncHealthCheck(index)');
  assert.equal(p.email, 'oncall@example.com');
  assert.equal(p.action, 'created');
});

test('parsePayload falls back to data.event for older event-alert webhooks', () => {
  const p = parsePayload(eventAlertWebhook);
  assert.equal(p.level, 'warning');
  assert.equal(p.title, 'Slow query detected');
  assert.equal(p.permalink, 'https://sentry.io/.../events/abc/');
  assert.equal(p.formatted, 'query took 12s');
  assert.equal(p.environment, 'staging');
  assert.equal(p.email, 'user@example.com');
});

test('parsePayload returns safe defaults for an empty body', () => {
  const p = parsePayload({});
  assert.equal(p.level, 'info');
  assert.equal(p.title, 'Sentry Alert');
  assert.equal(p.project, 'Unknown Project');
  assert.equal(p.environment, 'production');
  assert.equal(p.action, null);
  assert.equal(p.formatted, null);
  assert.equal(p.culprit, null);
});

test('parsePayload picks up the resolve action verb from the webhook root', () => {
  const p = parsePayload({ action: 'resolved', data: { issue: integrationWebhook.data.issue } });
  assert.equal(p.action, 'resolved');
});

test('pickColor prefers action color over level color', () => {
  assert.equal(pickColor('resolved', 'error'), '#2EB67D');
  assert.equal(pickColor('archived', 'error'), '#9B9B9B');
});

test('pickColor falls back to level color when no action style exists', () => {
  assert.equal(pickColor('created', 'error'), '#E01E5A');
  assert.equal(pickColor(null, 'warning'), '#ECB22E');
  assert.equal(pickColor(null, 'info'), '#36C5F0');
  assert.equal(pickColor(null, 'fatal'), '#7C0A02');
});

test('pickColor falls back to info for unknown levels', () => {
  assert.equal(pickColor(null, 'something-weird'), '#36C5F0');
});

test('buildBlocks renders a header with the action verb and a linked title for resolved issues', () => {
  const blocks = buildBlocks({
    ...parsePayload(integrationWebhook),
    action: 'resolved',
  });
  const header = blocks[0];
  assert.equal(header.type, 'section');
  assert.match(header.text.text, /Resolved:/);
  assert.match(header.text.text, /:white_check_mark:/);
  assert.match(header.text.text, /<https:\/\/sentry\.io\/[^|]+\|Error: Sync critically stale>/);
});

test('buildBlocks uses the level emoji when there is no action style', () => {
  const blocks = buildBlocks(parsePayload(integrationWebhook));
  assert.match(blocks[0].text.text, /:red_circle:/);
  assert.doesNotMatch(blocks[0].text.text, /Resolved:|Reopened:|Assigned:/);
});

test('buildBlocks emits a context block with shortId · project · environment', () => {
  const blocks = buildBlocks(parsePayload(integrationWebhook));
  const context = blocks.find(b => b.type === 'context');
  assert.ok(context, 'expected a context block');
  assert.equal(
    context.elements[0].text,
    '`INSIGHTSTACK-BACKEND-7` · insightstack-backend · production',
  );
});

test('buildBlocks renders firstSeen/lastSeen via the Slack <!date^…> helper', () => {
  const blocks = buildBlocks(parsePayload(integrationWebhook));
  const fields = blocks.find(b => b.type === 'section' && b.fields)?.fields ?? [];
  const firstSeen = fields.find(f => f.text.startsWith('*First seen:*'));
  const lastSeen = fields.find(f => f.text.startsWith('*Last seen:*'));
  assert.ok(firstSeen, 'expected a First seen field');
  assert.ok(lastSeen, 'expected a Last seen field');
  assert.match(firstSeen.text, /<!date\^\d+\^/);
  assert.match(lastSeen.text, /<!date\^\d+\^/);
});

test('buildBlocks omits fields that are missing instead of rendering "Unknown" or 0', () => {
  const blocks = buildBlocks(parsePayload({ data: { issue: { level: 'info', title: 'Bare' } } }));
  const fieldsBlock = blocks.find(b => b.type === 'section' && b.fields);
  const labels = (fieldsBlock?.fields || []).map(f => f.text.split(':')[0].replaceAll('*', ''));
  // Level is always present; none of the optional fields should appear here.
  assert.deepEqual(labels, ['Level']);

  const hasMessage = blocks.some(b => b.text?.text?.startsWith('*Message:*'));
  const hasCulprit = blocks.some(b => b.text?.text?.startsWith('*Culprit:*'));
  assert.equal(hasMessage, false);
  assert.equal(hasCulprit, false);
});

test('buildBlocks shows the title as plain text when no permalink is available', () => {
  const blocks = buildBlocks(parsePayload({ data: { issue: { level: 'info', title: 'No link here' } } }));
  assert.match(blocks[0].text.text, /\*:information_source: No link here\*/);
  assert.doesNotMatch(blocks[0].text.text, /<https?:\/\//);
});

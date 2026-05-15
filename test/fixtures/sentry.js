// Sentry webhook payload fixtures.
//
// All shapes and enum values below are sourced directly from Sentry's
// integration-platform webhook documentation:
//
//   issues:        https://docs.sentry.io/organization/integrations/integration-platform/webhooks/issues/
//   comments:      https://docs.sentry.io/organization/integrations/integration-platform/webhooks/comments/
//   metric alerts: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/metric-alerts/
//
// Keep these in sync with the docs — they are the contract these tests verify
// against. If Sentry adds or removes an enum value, update it here.

// "action: created | resolved | assigned | archived | unresolved" — issues docs.
export const SENTRY_ISSUE_ACTIONS = ['created', 'resolved', 'assigned', 'archived', 'unresolved'];

// Sentry's documented log levels.
export const SENTRY_LEVELS = ['fatal', 'error', 'warning', 'info', 'debug'];

// "priority: high | medium | low" — issues docs.
export const SENTRY_PRIORITIES = ['high', 'medium', 'low'];

// "substatus: archived_until_escalating | archived_until_condition_met |
//             archived_forever | escalating | ongoing | regressed | new"
export const SENTRY_SUBSTATUSES = [
  'archived_until_escalating',
  'archived_until_condition_met',
  'archived_forever',
  'escalating',
  'ongoing',
  'regressed',
  'new',
];

// Mirrors the issue object documented at the URL above. Override any field via
// the `issue` key; override anything else via `top`.
export const issueWebhook = ({ issue = {}, top = {} } = {}) => ({
  action: 'created',
  installation: { uuid: '24b397fc-a86e-43ef-9297-949e21b82480' },
  data: {
    issue: {
      url: 'https://sentry.io/api/0/issues/100/',
      web_url: 'https://sentry.io/insightstack/backend/issues/100/',
      project_url: 'https://sentry.io/api/0/projects/insightstack/backend/',
      id: '100',
      shareId: null,
      shortId: 'BACKEND-7',
      title: 'Error: Sync critically stale',
      culprit: 'processSyncHealthCheck(index)',
      permalink: 'https://sentry.io/insightstack/backend/issues/100/',
      logger: null,
      level: 'error',
      status: 'unresolved',
      statusDetails: {},
      substatus: 'new',
      isPublic: false,
      platform: 'javascript-node',
      project: {
        id: '1',
        name: 'Backend',
        slug: 'insightstack-backend',
        platform: 'javascript-node',
      },
      type: 'error',
      metadata: { type: 'Error', value: 'Last sync was 4h ago', filename: 'sync.ts' },
      numComments: 0,
      assignedTo: null,
      isBookmarked: false,
      isSubscribed: false,
      subscriptionDetails: null,
      hasSeen: false,
      annotations: [],
      issueType: 'error',
      issueCategory: 'error',
      priority: 'high',
      priorityLockedAt: null,
      isUnhandled: true,
      count: '42',
      userCount: 5,
      firstSeen: '2026-05-10T10:00:00.000000Z',
      lastSeen: '2026-05-15T12:00:00.000000Z',
      ...issue,
    },
  },
  actor: { type: 'user', id: '1', name: 'colleen' },
  ...top,
});

// Verbatim example from the comments docs page.
export const commentWebhook = {
  action: 'created',
  data: {
    comment: 'adding a comment',
    project_slug: 'sentry',
    comment_id: 1234,
    issue_id: 100,
    timestamp: '2022-03-02T21:51:44.118160Z',
  },
  installation: { uuid: 'eac5a0ae-60ec-418f-9318-46dc5e7e52ec' },
  actor: { type: 'user', id: 1, name: 'colleen' },
};

// Mirrors the metric-alert example payload. `metric_alert.alert_rule.triggers`
// is summarized — the tests only care that we don't crash on this shape.
export const metricAlertWebhook = {
  action: 'resolved',
  actor: { id: 'sentry', name: 'Sentry', type: 'application' },
  data: {
    description_text: '1000 events in the last 10 minutes\nFilter: level:error',
    description_title: 'Resolved: Too many errors',
    metric_alert: {
      id: '42',
      identifier: '1',
      status: 'resolved',
      alert_rule: { aggregate: 'count()', dataset: 'events', query: 'level:error', triggers: [] },
    },
    web_url: 'https://sentry.io/organizations/baz/alerts/1/',
  },
  installation: { uuid: 'a8e5d37a-696c-4c54-adb5-b3f28d64c7de' },
};

// Older non-integration "alert rule" webhook shape — uses data.event rather
// than data.issue. The handler should still produce a valid Slack message.
export const legacyEventAlert = {
  data: {
    event: {
      event_id: 'abc',
      level: 'warning',
      title: 'Slow query detected',
      culprit: 'pg.query',
      web_url: 'https://sentry.io/insightstack/backend/issues/100/events/abc/',
      logentry: { formatted: 'query took 12s' },
      environment: 'staging',
      user: { email: 'user@example.com' },
    },
    project_name: 'api',
  },
};

export const config = {
  runtime: 'edge',
}

const LEVEL_COLOR = {
  fatal: '#7C0A02',
  error: '#E01E5A',
  warning: '#ECB22E',
  info: '#36C5F0',
  debug: '#9B9B9B',
};

const ACTION_STYLE = {
  resolved: { color: '#2EB67D', emoji: ':white_check_mark:', verb: 'Resolved' },
  unresolved: { color: '#E01E5A', emoji: ':rotating_light:', verb: 'Reopened' },
  assigned: { color: '#4A154B', emoji: ':bust_in_silhouette:', verb: 'Assigned' },
  archived: { color: '#9B9B9B', emoji: ':file_cabinet:', verb: 'Archived' },
  ignored: { color: '#9B9B9B', emoji: ':mute:', verb: 'Ignored' },
  created: null,
};

const LEVEL_EMOJI = {
  fatal: ':skull:',
  error: ':red_circle:',
  warning: ':warning:',
  info: ':information_source:',
  debug: ':beetle:',
};

const toUnix = (value) => {
  if (!value) return null;
  const ms = typeof value === 'number' ? value * 1000 : Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};

const slackDate = (value, fallback) => {
  const unix = toUnix(value);
  if (!unix) return fallback;
  return `<!date^${unix}^{date_short_pretty} at {time}|${fallback}>`;
};

export const buildBlocks = ({
  action,
  level,
  title,
  permalink,
  shortId,
  project,
  environment,
  priority,
  substatus,
  count,
  userCount,
  firstSeen,
  lastSeen,
  email,
  formatted,
  culprit,
}) => {
  const style = ACTION_STYLE[action] || null;
  const emoji = style?.emoji || LEVEL_EMOJI[level] || ':grey_question:';
  const verb = style?.verb;
  const titleText = permalink ? `<${permalink}|${title}>` : title;
  const headerText = verb ? `${emoji} ${verb}: ${titleText}` : `${emoji} ${titleText}`;

  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${headerText}*` },
    },
  ];

  if (shortId) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `\`${shortId}\` · ${project} · ${environment}` }],
    });
  }

  const fields = [
    { label: 'Level', value: level },
    { label: 'Priority', value: priority },
    { label: 'Status', value: substatus },
    { label: 'Events', value: count ? String(count) : null },
    { label: 'Users', value: userCount ? String(userCount) : null },
    { label: 'First seen', value: firstSeen ? slackDate(firstSeen, firstSeen) : null },
    { label: 'Last seen', value: lastSeen ? slackDate(lastSeen, lastSeen) : null },
    { label: 'User', value: email },
  ].filter(f => f.value);

  if (fields.length) {
    blocks.push({
      type: 'section',
      fields: fields.map(f => ({ type: 'mrkdwn', text: `*${f.label}:*\n${f.value}` })),
    });
  }

  blocks.push({ type: 'divider' });

  if (formatted) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Message:*\n${formatted}` },
    });
  }

  if (culprit) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Culprit:*\n\`${culprit}\`` },
    });
  }

  return blocks;
};

export const pickColor = (action, level) => {
  if (action && ACTION_STYLE[action]?.color) return ACTION_STYLE[action].color;
  return LEVEL_COLOR[level] || LEVEL_COLOR.info;
};

export const buildSlackMessage = (channel, payload) => {
  const blocks = buildBlocks(payload);
  const color = pickColor(payload.action, payload.level);
  const fallback = payload.title || 'Sentry alert';
  return { channel, text: fallback, attachments: [{ color, blocks, fallback }] };
};

// Section text in Block Kit caps at 3000 chars; leave room for the surrounding
// triple-backtick fence used to render JSON dumps.
const DEBUG_TEXT_MAX = 2800;

const truncate = (s, max) => {
  if (typeof s !== 'string') s = String(s);
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
};

const safeStringify = (value) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch (e) {
    return `[unstringifiable payload: ${e?.message || e}]`;
  }
};

// A minimal yellow-bar message used whenever the handler can't produce a
// proper Sentry alert: unrecognized payload shapes, JSON parse failures, or
// uncaught exceptions in the pretty-render path. The goal is that *something*
// always lands in Slack so the user notices, rather than the failure hiding
// in Vercel logs.
export const buildDebugMessage = (channel, summary, body) => {
  const dump = truncate(typeof body === 'string' ? body : safeStringify(body), DEBUG_TEXT_MAX);
  return {
    channel,
    text: summary,
    attachments: [{
      color: '#ECB22E',
      fallback: summary,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `:warning: *${summary}*` } },
        { type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${dump}\`\`\`` } },
      ],
    }],
  };
};

// Webhook resource types we have a formatter for. Anything else (comment,
// metric_alert, future shapes) flows through buildDebugMessage so the
// content still lands in Slack, labeled with the detected type.
export const RENDERABLE_WEBHOOK_TYPES = new Set(['issue', 'event_alert']);

// Identifies the Sentry webhook resource type. Prefers the documented
// `Sentry-Hook-Resource` header, falling back to payload-shape inference
// for proxies, tests, or future versions that don't send it.
// Header values per the Sentry docs: `issue`, `event_alert`, `comment`,
// `metric_alert`, `installation`.
export const detectWebhookType = (body, headers) => {
  const header = headers?.get?.('sentry-hook-resource');
  if (header) return header;

  const d = body?.data;
  if (!d) return 'unknown';
  if (d.issue) return 'issue';
  if (d.event) return 'event_alert';
  if (d.metric_alert) return 'metric_alert';
  if (typeof d.comment === 'string' || d.comment_id != null) return 'comment';
  return 'unknown';
};

export const isRecognizedIssueOrEvent = (body, headers) =>
  RENDERABLE_WEBHOOK_TYPES.has(detectWebhookType(body, headers));

const postToSlack = async (payload) => {
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${process.env.SLACK_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.ok) {
      console.error('Slack API Error:', data.error);
    }
    return data;
  } catch (e) {
    console.error('Network/Fetch error posting to Slack:', e);
    return { ok: false, error: String(e?.message || e) };
  }
};

export const parsePayload = (body) => {
  const payloadData = body?.data || {};
  // Sentry integration webhooks send the issue at data.issue; event-alert webhooks send data.event
  const source = payloadData.issue || payloadData.event || payloadData;

  const projectField = source?.project;
  const project =
    (projectField && (projectField.slug || projectField.name)) ||
    payloadData?.project_name ||
    payloadData?.project ||
    'Unknown Project';

  return {
    action: body?.action || null,
    level: source?.level || 'info',
    title: source?.metadata?.title || source?.title || 'Sentry Alert',
    permalink: source?.permalink || source?.web_url || null,
    shortId: source?.shortId || source?.short_id || null,
    project,
    environment: source?.environment || 'production',
    priority: source?.priority || null,
    substatus: source?.substatus || source?.status || null,
    count: source?.count ? Number(source.count) : null,
    userCount: source?.userCount ?? source?.user_count ?? null,
    firstSeen: source?.firstSeen || source?.first_seen || null,
    lastSeen: source?.lastSeen || source?.last_seen || null,
    email: source?.user?.email || source?.assignedTo?.email || null,
    formatted:
      source?.metadata?.value ||
      source?.logentry?.formatted ||
      source?.message ||
      null,
    culprit: source?.culprit || null,
  };
};

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed. Send a POST request.', { status: 405 });
  }

  const channel = process.env.CHANNEL_ID;

  // Read the raw body first so we can include it in a Slack debug message
  // if JSON parsing fails.
  let rawText = '';
  try {
    rawText = await req.text();
  } catch (err) {
    console.error('Failed to read request body:', err);
    return new Response('Bad Request: Could not read body', { status: 400 });
  }

  let body;
  try {
    body = JSON.parse(rawText);
    console.log('RAW SENTRY PAYLOAD:', JSON.stringify(body, null, 2));
  } catch (err) {
    await postToSlack(buildDebugMessage(
      channel,
      'Sentry webhook had invalid JSON',
      { error: String(err?.message || err), body: truncate(rawText, 1500) },
    ));
    return new Response('Bad Request: Invalid JSON', { status: 400 });
  }

  try {
    const hookType = detectWebhookType(body, req.headers);
    if (!RENDERABLE_WEBHOOK_TYPES.has(hookType)) {
      // Comment webhooks, metric_alert webhooks, brand-new payload shapes:
      // surface them in Slack with the detected type so we know what
      // formatter to add next.
      await postToSlack(buildDebugMessage(
        channel,
        `Received Sentry "${hookType}" webhook — no formatter for this type yet`,
        body,
      ));
      return new Response(`Webhook Processed (no formatter for "${hookType}")`, { status: 200 });
    }

    const payload = parsePayload(body);
    const message = buildSlackMessage(channel, payload);
    const result = await postToSlack(message);

    // If Slack rejected the formatted message (e.g. invalid_blocks because a
    // future Sentry change produced a value we don't render correctly), fall
    // back to a raw debug dump so the failure surfaces.
    if (result && result.ok === false) {
      await postToSlack(buildDebugMessage(
        channel,
        `Slack rejected the formatted Sentry alert (${result.error})`,
        body,
      ));
    }
  } catch (err) {
    console.error('Handler error:', err);
    await postToSlack(buildDebugMessage(
      channel,
      `Sentry webhook handler error: ${err?.message || err}`,
      body,
    ));
  }

  return new Response('Webhook Processed Successfully', { status: 200 });
};

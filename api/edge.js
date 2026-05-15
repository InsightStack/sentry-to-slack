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

const COMMENT_VERB = {
  created: 'commented on',
  updated: 'edited a comment on',
  deleted: 'deleted a comment on',
};

export const buildCommentMessage = (channel, body) => {
  const d = body?.data || {};
  const actor = body?.actor?.name || 'Someone';
  const verb = COMMENT_VERB[body?.action] || 'commented on';
  const issueRef = d.issue_id != null ? `issue #${d.issue_id}` : 'an issue';
  const projectRef = d.project_slug ? ` in \`${d.project_slug}\`` : '';
  const headerText = `:speech_balloon: ${actor} ${verb} ${issueRef}${projectRef}`;
  const fallback = `${actor} ${verb} ${issueRef}`;

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${headerText}*` } },
  ];

  if (typeof d.comment === 'string' && d.comment.length) {
    const quoted = d.comment.split('\n').map(line => `> ${line}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(quoted, 2900) },
    });
  }

  if (d.timestamp) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: slackDate(d.timestamp, d.timestamp) }],
    });
  }

  return {
    channel,
    text: fallback,
    attachments: [{ color: '#36C5F0', fallback, blocks }],
  };
};

const METRIC_ALERT_STYLE = {
  critical: { color: '#E01E5A', emoji: ':rotating_light:', verb: 'Critical' },
  warning: { color: '#ECB22E', emoji: ':warning:', verb: 'Warning' },
  resolved: { color: '#2EB67D', emoji: ':white_check_mark:', verb: 'Resolved' },
};

export const buildMetricAlertMessage = (channel, body) => {
  const d = body?.data || {};
  const ma = d.metric_alert || {};
  const rule = ma.alert_rule || {};
  const status = body?.action || ma.status || null;
  const style = METRIC_ALERT_STYLE[status] || null;
  const emoji = style?.emoji || ':bar_chart:';
  const verb = style?.verb;
  const color = style?.color || '#36C5F0';

  const title = d.description_title || rule.name || 'Sentry metric alert';
  const url = d.web_url || null;
  const titleText = url ? `<${url}|${title}>` : title;
  const headerText = verb ? `${emoji} ${verb}: ${titleText}` : `${emoji} ${titleText}`;

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${headerText}*` } },
  ];

  if (d.description_text) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(d.description_text, 2900) },
    });
  }

  const fields = [
    { label: 'Aggregate', value: rule.aggregate },
    { label: 'Dataset', value: rule.dataset },
    { label: 'Query', value: rule.query ? `\`${rule.query}\`` : null },
    { label: 'Status', value: ma.status },
  ].filter(f => f.value);

  if (fields.length) {
    blocks.push({
      type: 'section',
      fields: fields.map(f => ({ type: 'mrkdwn', text: `*${f.label}:*\n${f.value}` })),
    });
  }

  return {
    channel,
    text: title,
    attachments: [{ color, fallback: title, blocks }],
  };
};

// Webhook resource → builder. Anything not in this map and not in
// SILENT_WEBHOOK_TYPES flows through buildDebugMessage so the raw payload
// still lands in Slack, labeled with the detected type.
export const FORMATTERS = {
  issue: (channel, body) => buildSlackMessage(channel, parsePayload(body)),
  event_alert: (channel, body) => buildSlackMessage(channel, parsePayload(body)),
  comment: buildCommentMessage,
  metric_alert: buildMetricAlertMessage,
};

// `installation` is the integration lifecycle (install / uninstall), not an
// alert — it would just be noise in the alert channel.
export const SILENT_WEBHOOK_TYPES = new Set(['installation']);

const hexToBytes = (hex) => {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

// Verifies the Sentry-Hook-Signature header against the raw request body
// using the integration's client secret. Sentry documents this as a hex
// HMAC-SHA256 of the body. crypto.subtle.verify performs the comparison in
// constant time, so no manual timing-safe equality is needed.
//
// Returns true/false. Throws only on programmer error (e.g. importKey of an
// invalid secret), never on attacker-controlled input.
export const verifySentrySignature = async (rawBody, signatureHex, secret) => {
  if (!secret || !signatureHex) return false;
  const sigBytes = hexToBytes(signatureHex);
  if (!sigBytes) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(rawBody));
};

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

  // Verify Sentry's HMAC signature over the raw body. Skipped entirely when
  // SENTRY_CLIENT_SECRET is unset, so existing deployments keep working until
  // the operator opts in by setting the env var.
  const secret = process.env.SENTRY_CLIENT_SECRET;
  if (secret) {
    const signature = req.headers.get('sentry-hook-signature');
    const ok = await verifySentrySignature(rawText, signature, secret);
    if (!ok) {
      console.warn('Rejected Sentry webhook: invalid or missing signature');
      return new Response('Unauthorized: invalid signature', { status: 401 });
    }
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

    if (SILENT_WEBHOOK_TYPES.has(hookType)) {
      return new Response(`Webhook Processed ("${hookType}" silently ignored)`, { status: 200 });
    }

    const formatter = FORMATTERS[hookType];
    if (!formatter) {
      // Brand-new payload shapes: surface them in Slack with the detected
      // type so we know what formatter to add next.
      await postToSlack(buildDebugMessage(
        channel,
        `Received Sentry "${hookType}" webhook — no formatter for this type yet`,
        body,
      ));
      return new Response(`Webhook Processed (no formatter for "${hookType}")`, { status: 200 });
    }

    const message = formatter(channel, body);
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

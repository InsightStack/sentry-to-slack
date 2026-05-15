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

const sendMessage = async (channel, payload) => {
  const body = buildSlackMessage(channel, payload);

  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${process.env.SLACK_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!data.ok) {
      console.error('Slack API Error:', data.error);
    } else {
      console.log('Successfully sent to Slack!');
    }

    return data;
  } catch (e) {
    console.error('Network/Fetch error:', e);
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

  let body;
  try {
    body = await req.json();
    console.log('RAW SENTRY PAYLOAD:', JSON.stringify(body, null, 2));
  } catch (err) {
    console.error('Failed to parse JSON body:', err);
    return new Response('Bad Request: Invalid JSON', { status: 400 });
  }

  const payload = parsePayload(body);
  await sendMessage(process.env.CHANNEL_ID, payload);

  return new Response('Webhook Processed Successfully', { status: 200 });
};

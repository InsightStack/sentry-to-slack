export const config = {
  runtime: 'edge',
}

const sendMessage = async (channel, {level, formatted, environment, email,title, culprit, project}) => {
  console.info({channel, level, formatted, environment, email, title, culprit, project});
const isError = level === "error";
  const blocks = [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": `${isError? ":red_circle:" : ""} *${title}*`
      }
    },
    {
      "type": "section",
      "fields": [
        {
          "type": "mrkdwn",
          "text": `*Environment:*\n${environment}`
        },
        {
          "type": "mrkdwn",
          "text": `*Level:*\n${level}`
        },
        {
          "type": "mrkdwn",
          "text": `*Project:*\n${project}`
        }
      ]
    },
    
    {
      "type": "section",
      "fields": [
        {
          "type": "mrkdwn",
          "text": `*User:*\n${email}`
        }
      ]
    },
    {
      "type": "divider"
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": `*Message:*\n${formatted}`
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": `*Message:*\n${culprit}`
      }
    },
    {
      "type": "divider"
    },
  ];
try{
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${process.env.SLACK_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      channel,
      blocks,
    }),
  });

  return response.data;
}catch(e){
  console.error(e);
}
}
export default async (req) => {
  const body = await req.json();
  
  // Safely extract properties with fallbacks
  const project = body?.project || 'Unknown Project';
  const culprit = body?.culprit || 'Unknown Culprit';
  
  const event = body?.event || {};
  const level = event?.level || 'info';
  const formatted = event?.logentry?.formatted || event?.message || 'No message provided';
  const email = event?.user?.email || 'Unknown User';
  const environment = event?.environment || 'production';
  const title = event?.metadata?.title || 'Sentry Alert';

  await sendMessage(process.env.CHANNEL_ID, {level, formatted, environment, email, title, culprit, project});
  
  return new Response(`Event processed successfully`);
}
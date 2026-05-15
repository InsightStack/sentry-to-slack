const axios = require('axios')
const slackClient = axios.create({
  baseURL: 'https://slack.com/api',
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    Authorization: `Bearer ${process.env.SLACK_ACCESS_TOKEN}`,
  },
})

module.exports.sendMessage = async (channel, {level, formatted, environment, email,title, culprit, project}) => {
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

  const response = await slackClient.post('/chat.postMessage', {
    channel,
    blocks,
  });

  return response.data;
}

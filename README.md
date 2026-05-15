# **Say Goodbye to Paid Sentry Alerts: Get Slack Error Notifications for Free!**

Are you tired of paying for Sentry's Slack integration? What if I told you there's a way to send error notifications to Slack *for free*? That's right—no more paying for what you can do with a few simple tricks. By leveraging Sentry's webhook, Vercel's edge functions, and Slack’s free API, you can set up a system that gets real-time error alerts sent straight to Slack without shelling out a dime. Intrigued? Let me show you how.

## Why Pay for Something You Can Do for Free?

Sentry offers a built-in integration with Slack, but it’s locked behind a paywall. For smaller projects or indie developers, that’s just not worth it. Luckily, we can bypass this by creating a webhook listener on Vercel that formats error notifications and sends them to Slack via the free Slack API.

Ready to ditch the paid plans? Let’s dive in.

## Step 1: Configuring the Sentry Webhook (No, It’s Not Hard)

Sentry provides a webhook legacy integration that lets you send error events to external services. Here’s how you hook that up to a free Vercel edge function:

1. **Open Your Sentry Project**: Head to your project settings in Sentry.
2. **Enable Webhooks**: Under **Legacy Integrations**, add a new webhook. This is where Sentry will send error data.
3. **Point It to Vercel**: Once we set up our Vercel function, you’ll use that URL here. But first, let’s get the listener set up.

## Step 2: Vercel Edge Function—The Magic Sauce

If you’re new to Vercel, it’s a serverless platform that allows you to run code at the "edge" for free (within certain limits). We’re going to deploy an edge function that will listen for Sentry events, format them, and send them to Slack. This repo contains all the code you need .

### What This Code Does:

- **Receives Sentry Events**: The function is triggered when Sentry sends an event (like an error).
- **Formats the Message**: It parses the event and formats a Slack message using blocks (the fancy Slack message formatting system).
- **Sends It to Slack**: Using Slack’s API, it posts the error message to a channel of your choice.

### Step 3: Slack Setup—Let the Notifications Begin

Here’s how you make sure Slack gets the error alerts:

1. **Create a Slack App**: Visit [api.slack.com/apps](https://api.slack.com/apps) and create a new app in your workspace.
2. **Permissions**: Under **OAuth & Permissions**, add the `chat:write` permission.
3. **Install the App**: Grab the OAuth token after installing the app to your workspace.
4. **Environment Variables**: Set the following in Vercel:
   - `SLACK_ACCESS_TOKEN` — bot token from your Slack app's OAuth page.
   - `CHANNEL_ID` — the Slack channel to post to.
   - `SENTRY_CLIENT_SECRET` *(recommended)* — the **Client Secret** from your Sentry internal integration's settings page. When set, the function verifies the `Sentry-Hook-Signature` HMAC on every request and rejects anything that doesn't match. Leave unset to skip verification (useful for first-time setup, but anyone who knows your Vercel URL can post fake alerts).

### Step 4: Deploy the Function to Vercel

Push the code to a GitHub repository, connect it to Vercel, and deploy. You’ll need to add your Slack token and channel ID as environment variables. Vercel will handle the rest.

Now, when an error happens in Sentry, it will trigger your edge function, and you’ll see those notifications in Slack within seconds!

## Step 5: Testing the Integration

To test if everything’s working, trigger an error in your Sentry project. Check your Slack channel for the notification! If it worked, you should see a neatly formatted message with all the error details.

## Why This is Awesome

- **It’s Free**: No more paying for Sentry’s Slack integration.
- **Real-Time Alerts**: Get instant error notifications as soon as they happen.
- **Customizable**: You control how the Slack messages look and what data they contain.
- **No Maintenance**: Vercel’s serverless functions handle everything with almost no setup costs.

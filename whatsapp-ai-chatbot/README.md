# Hominal Healthcare WhatsApp AI Chatbot

This is a minimal WhatsApp Cloud API webhook for Hominal Healthcare Pvt Ltd. It receives inbound WhatsApp messages, asks OpenAI for a healthcare-assistant reply, and sends the response back through Meta's WhatsApp Cloud API.

There are two webhook versions:

- `server.js` for Node/VPS deployment.
- `whatsapp-webhook.php` for Hiox/cPanel shared hosting.

## 1. Meta setup

Safari is already open to:

- Meta Business Suite for the current business account.
- Meta for Developers.
- WhatsApp Cloud API Get Started documentation.

In Meta for Developers:

1. Create a Meta app with the WhatsApp use case.
2. Connect it to the Hominal Healthcare business portfolio.
3. Add or select a WhatsApp Business Account.
4. Note the `Phone number ID` and `WhatsApp Business Account ID`.
5. Create a system user in Business Settings.
6. Assign the app and WhatsApp account assets to that system user.
7. Generate a permanent token with these permissions:
   - `business_management`
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`

## 2. Local setup

```bash
cd /Users/bhawinkadikar/Downloads/bhavin/whatsapp-ai-chatbot
cp .env.example .env
```

Fill in `.env`:

```bash
WHATSAPP_VERIFY_TOKEN=your-own-random-webhook-token
WHATSAPP_ACCESS_TOKEN=your-meta-system-user-token
WHATSAPP_PHONE_NUMBER_ID=your-meta-phone-number-id
WHATSAPP_APP_SECRET=your-meta-app-secret
OPENAI_API_KEY=your-openai-api-key
```

Load the environment and start:

```bash
set -a
source .env
set +a
npm start
```

## 3. Public webhook URL

Meta must reach this server from the internet. For local testing, expose port `3000` with a tunnel such as ngrok or Cloudflare Tunnel.

Use this callback URL in Meta:

```text
https://your-public-url/webhook
```

Use the same verify token that you placed in `WHATSAPP_VERIFY_TOKEN`.

Subscribe the webhook to WhatsApp `messages` events.

For production, set `WHATSAPP_APP_SECRET` so the webhook can verify Meta's
`X-Hub-Signature-256` signature and reject forged requests.

## 4. Test flow

1. Send a WhatsApp message to the test/business number.
2. Meta calls `POST /webhook`.
3. The bot generates a concise Hominal Healthcare reply.
4. The bot replies on WhatsApp.

Health check:

```bash
curl http://localhost:3000/health
```

Webhook verification check:

```bash
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=your-own-random-webhook-token&hub.challenge=12345"
```

## 5. Hiox/cPanel PHP deployment

If you want to link WhatsApp using the existing Hiox hosting, upload these files to a PHP-enabled subdomain or folder:

- `whatsapp-webhook.php`
- `config.php`

Create `config.php` from `config.example.php` and fill in the real credentials.
Also set `whatsapp_app_secret` so the PHP webhook validates Meta signatures.

Recommended webhook URL:

```text
https://crm.hominalhealthcare.com/whatsapp-webhook.php
```

If you prefer to keep the CRM clean, create a separate subdomain such as:

```text
https://whatsapp.hominalhealthcare.com/whatsapp-webhook.php
```

In Meta, set:

- Callback URL: the webhook URL above
- Verify token: the same value from `config.php`
- Webhook field: `messages`

## 6. Production hardening

Both webhook implementations now include:

- fast `200 OK` acknowledgement before longer processing
- duplicate message suppression using the inbound WhatsApp message ID
- OpenAI failure fallback so the bot still replies with a safe default
- optional Meta signature validation using the app secret

Before going live:

1. Keep `ALLOWED_TEST_NUMBERS` limited during testing.
2. Remove `ALLOWED_TEST_NUMBERS` only after real-device verification succeeds.
3. Set the Meta app secret in `.env` or `config.php`.
4. Keep the number subscribed only to `messages` unless you need more events.

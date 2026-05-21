# Hominal WhatsApp Link Details

Meta app:

- App name: `hominal healthcare pvt ltd`
- App ID: `26523017773997713`
- Business: `Hominal Health CARE`

WhatsApp account:

- WhatsApp number: `+91 92748 17492`
- Phone Number ID: `970763749464457`
- WhatsApp Business Account ID: `915729954587084`

Use these values in `config.php`:

```php
'whatsapp_phone_number_id' => '970763749464457',
```

The access token still needs to be generated in Meta and placed in `config.php`.
Also copy the Meta app secret into:

```php
'whatsapp_app_secret' => 'YOUR_META_APP_SECRET',
```

Recommended webhook URL after upload:

```text
https://crm.hominalhealthcare.com/whatsapp-webhook.php
```

Recommended verify token:

```text
hominal-whatsapp-webhook-2026
```

Use the same verify token in Meta and in `config.php`.

For safer production setup:

- keep `allowed_test_numbers` limited to your own numbers until final testing is done
- subscribe only to `messages`
- do not go live without the Meta app secret configured, or the webhook cannot verify request signatures

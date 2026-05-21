# Hominal CRM Deployment

This CRM is prepared to run as a static website backed by Supabase at:

`https://crm.hominalhealthcare.com`

## Files to publish

Upload these files to the web root for `crm.hominalhealthcare.com`:

- `index.html`
- `supabase-config.js`
- `hominal-transparent-logo.png`

Optional support files:

- `hominal_crm_supabase.sql`
- `CNAME`
- `deploy/crm.hominalhealthcare.com.nginx.conf`

## Supabase steps

1. Open your Supabase SQL editor.
2. Run `hominal_crm_supabase.sql`.
3. In Supabase Auth settings, set:
   - Site URL: `https://crm.hominalhealthcare.com`
   - Redirect URL: `https://crm.hominalhealthcare.com`

## Domain / hosting steps

If you host on your own server:

1. Point DNS for `crm.hominalhealthcare.com` to your server.
2. Copy the three publish files into your web root.
3. Use the Nginx config in `deploy/crm.hominalhealthcare.com.nginx.conf`.
4. Install SSL for the subdomain.

If you host on static hosting:

1. Deploy `index.html`, `supabase-config.js`, and `hominal-transparent-logo.png`.
2. Bind the custom domain `crm.hominalhealthcare.com`.
3. Keep `supabase-config.js` in the same folder as `index.html`.

## Local launch

For local testing, run:

```bash
cd /Users/bhawinkadikar/Downloads/bhavin
python3 -m http.server 8787
```

Then open:

`http://127.0.0.1:8787`

## Current production config

`supabase-config.js` is already filled with the current Supabase URL and anon key used by the CRM.

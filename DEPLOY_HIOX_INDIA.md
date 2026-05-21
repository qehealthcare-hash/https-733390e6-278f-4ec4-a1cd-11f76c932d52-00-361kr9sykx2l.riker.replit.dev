# Deploy Hominal CRM On Hiox India

This guide assumes your Hiox India account uses standard cPanel/shared hosting.

Target domain:

`crm.hominalhealthcare.com`

## Files to upload to Hiox

Upload these files into the subdomain document root:

- `index.html`
- `supabase-config.js`
- `hominal-transparent-logo.png`
- `.htaccess`

If Hiox creates the subdomain folder automatically, it is usually one of these:

- `public_html/crm`
- `crm.hominalhealthcare.com`

Use the exact folder shown by Hiox when you create the subdomain.

## Hiox cPanel steps

1. Log in to your Hiox India account.
2. Open `Subdomains`.
3. Create subdomain:
   - Name: `crm`
   - Domain: `hominalhealthcare.com`
4. Open `File Manager`.
5. Open the new subdomain folder.
6. Upload the files from `hominal_crm_hiox_india_package.zip`.
7. Make sure `index.html` is directly inside that folder, not inside another nested folder.
8. Enable SSL or AutoSSL for `crm.hominalhealthcare.com`.

## DNS

If Hiox manages your DNS, the subdomain is usually created automatically.

If DNS is managed elsewhere, point:

- `crm.hominalhealthcare.com`

to the Hiox hosting server using the record shown in your Hiox panel.

## Supabase

Run:

- `hominal_crm_supabase.sql`

in your Supabase SQL editor.

Then in Supabase settings set:

- Site URL: `https://crm.hominalhealthcare.com`
- Redirect URL: `https://crm.hominalhealthcare.com`

## Final check

After upload, open:

`https://crm.hominalhealthcare.com`

If the page loads but logo/config is missing, confirm these files are in the same folder as `index.html`:

- `supabase-config.js`
- `hominal-transparent-logo.png`
- `.htaccess`

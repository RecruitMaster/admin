# Recruiter profile inspection and personal email

Users table includes an expandable recruiter card with actual photo, country, city,
position, about, hiring roles and public-profile link. Missing values are explicit.
No completeness percentage or automatic publication. Country/address tables are
those from the previously installed recruiter profile release. No migrations.

Email editor sends one plain-text message to the selected active/unverified recruiter.
Sender and Reply-To are fixed to dkechkin@recruitmaster.net. Subject/body limits,
session CSRF token and 30-second session throttle protect the endpoint. Deleted,
banned and non-recruiter accounts cannot receive through this endpoint.
No attachments, remote content or arbitrary From/To fields. SMTP errors do not expose
credentials. Success means SMTP acceptance, not confirmed delivery. No sent-folder
copy is created by SMTP; use the mail provider's delivery logs when investigating.
Drafts are held in browser memory only and disappear on page reload.

Configure ONLY in the server admin application's private .env, never in GitHub:

```
ADMIN_MAIL_ENABLED=true
ADMIN_MAIL_HOST=<SMTP host provided by mailbox provider>
ADMIN_MAIL_PORT=465
ADMIN_MAIL_USER=dkechkin@recruitmaster.net
ADMIN_MAIL_PASSWORD=<mailbox or application password>
```

Use port 465 (implicit TLS) or 587 (STARTTLS). Certificate validation stays enabled.
Do not enable until the provider authorizes this account to send as the fixed sender.
Without configuration the UI reports that sending is not configured.

Build: npm ci && npm run build.
Tests: node tests/personal-mail.cjs (mock SMTP, no email sent),
node tests/recruiter-card.browser.cjs (mock endpoint, local Chromium).
Existing role formatter test: tests/user-roles.browser.cjs.
Production has not been changed by developing or running these tests.

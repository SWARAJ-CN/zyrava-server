# Gmail on Render Free, without a purchased domain

Render Free blocks Gmail SMTP ports. Your Gmail app password works locally but cannot remove that network restriction. ZYRAVA now supports Gmail's HTTPS API (`EMAIL_PROVIDER=gmail`) and still uses Nodemailer to create the branded message and inline logo. OTPs, admin-composed messages, and login notifications all use this transport.

This setup needs Google OAuth authorization for **zyrava00@gmail.com**. A Gmail app password is not a Google OAuth client secret or refresh token. Keep the current local SMTP configuration until this setup is complete.

## One-time Google setup

1. Open [Google Cloud Console](https://console.cloud.google.com/), select/create your project, and enable **Gmail API** in APIs & Services → Library.
2. Configure the project's Google Auth Platform/OAuth consent screen. For an initial test, add `zyrava00@gmail.com` as a test user. The required scope is `https://www.googleapis.com/auth/gmail.send`; this allows sending without reading the inbox. Complete any Google consent/verification requirements shown for your application.
3. Create an OAuth client ID of type **Web application**. Add this exact authorized redirect URI: `https://developers.google.com/oauthplayground`. Keep the resulting client ID and client secret private.
4. Open Google's [OAuth Playground](https://developers.google.com/oauthplayground/). In its settings, choose **Google** endpoints, **Server-side** flow, **Offline** access, and **Use your own OAuth credentials**. Enter your client ID and secret. Using your own credentials avoids Playground's default 24-hour refresh-token revocation.
5. Enter the `https://www.googleapis.com/auth/gmail.send` scope and select **Authorize APIs**. Sign in as **zyrava00@gmail.com** and approve the sending permission yourself.
6. Select **Exchange authorization code for tokens**. Copy the **refresh token**, not the short-lived access token. Do not share a Playground URL containing tokens.

An external OAuth app left in **Testing** issues Gmail-scope refresh tokens that expire after seven days. For sustained production use, complete Google's applicable requirements, change the publishing status appropriately, and authorize again. Password changes, revoked permissions, or Google account policies can also require reauthorization. See [Google's refresh-token guidance](https://developers.google.com/identity/protocols/oauth2#expiration).

## Render environment

In Render → the **zyrava-server web service** → Environment, set:

```dotenv
EMAIL_PROVIDER=gmail
EMAIL_OTP_ENABLED=true
GMAIL_USER=zyrava00@gmail.com
GMAIL_CLIENT_ID=<your Google OAuth client ID>
GMAIL_CLIENT_SECRET=<your Google OAuth client secret>
GMAIL_REFRESH_TOKEN=<refresh token from the authorized Gmail account>
ADMIN_AUTH_EMAILS_ENABLED=true
ADMIN_NOTIFICATION_EMAIL=zyrava00@gmail.com
```

Save and redeploy the updated backend. The `GMAIL_*` variables belong only in the backend environment, never in web/mobile public variables or committed files. Existing SMTP settings can remain; `EMAIL_PROVIDER=gmail` explicitly selects HTTPS instead. Resend and a custom domain are not needed for this option.

## Verify

- `npm run mail:verify` with the same backend settings refreshes the OAuth access token without sending a message. It does not prove that Gmail API sending permissions or inbox delivery work.
- Try one real OTP login, verify the code, and check `zyrava00@gmail.com` for the admin sign-in notification. A phone login should send an admin notice containing the phone number and should not require OTP.
- Open Admin → System → Email delivery for safe error categories. `gmail_authorization` means the OAuth credentials/refresh token need attention. `gmail_permission` means check the enabled Gmail API and granted scope. `rate_limited` means Gmail/provider sending limits were reached.
- Gmail sending limits and spam filtering still apply. Queued admin alerts retry separately; they do not block login or bypass OTP.

Reference: [Gmail sending API](https://developers.google.com/workspace/gmail/api/guides/sending), [Render Free SMTP restrictions](https://render.com/docs/free).

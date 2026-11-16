# ZYRAVA auth API

Express + MongoDB backend for the music app. MVC layout, stateless JWT access
tokens, rotating refresh sessions, double-submit CSRF and strict validation.

```
src/
├── config/        env parsing, pooled Mongo connection
├── models/        User, Session (Mongoose, unique indexes, TTL)
├── validators/    Zod schemas (strict objects)
├── services/      auth business logic
├── controllers/   HTTP request/response mapping
├── routes/        URL wiring + middleware order
├── middleware/    auth, csrf, validate, rate limits, errors
└── utils/         tokens, cookies, http helpers
```

## Run locally

```bash
cd backend
cp .env.example .env     # then fill in MONGO_URI + JWT secrets
npm install
npm run dev              # http://localhost:5000
```

The frontend reads `NEXT_PUBLIC_API_URL` (default `http://localhost:5000`).
MongoDB can be local (`mongodb://127.0.0.1:27017/zyrava`) or Atlas.

## Endpoints

| Method | Path                | Notes                                        |
| ------ | ------------------- | -------------------------------------------- |
| GET    | `/health`           | uptime + DB status, no rate limit            |
| GET    | `/api/auth/csrf`    | sets the CSRF cookie, returns the token      |
| POST   | `/api/auth/register`| name?, email **or** phone, password, remember|
| POST   | `/api/auth/login`   | identifier (email/phone), password, remember |
| POST   | `/api/auth/refresh` | rotates the refresh cookie, new access token |
| POST   | `/api/auth/logout`  | revokes the session, clears the cookie       |
| GET    | `/api/auth/me`      | requires `Authorization: Bearer <jwt>`       |

Every POST requires `X-CSRF-Token` matching the `zyrava_csrf` cookie. The
access token is returned in JSON and kept in memory by the SPA; the refresh
token lives in an httpOnly cookie (`/api/auth`, 7 days, or 30 with "remember
me") and is rotated and hashed on every refresh.

## Security decisions

- **Passwords**: bcrypt (cost 10), 8–72 chars, letter + number required.
- **Validation**: Zod `.strict()` on body/query/params; unknown keys rejected.
- **Mongo**: `sanitizeFilter`, schema-validated writes, unique sparse indexes on
  email and phone, no raw query objects from clients.
- **Sessions**: only SHA-256 hashes stored; `findOneAndDelete` on refresh makes
  replay of a rotated token fail; TTL index cleans expired rows.
- **CSRF**: 256-bit double-submit token, constant-time compare.
- **Rate limits**: 240 req/min/IP global, 25 auth attempts/15 min/IP, 120
  refreshes/15 min/IP.
- **Headers**: Helmet, CORS allowlist with credentials, `x-powered-by` off,
  16 kB JSON cap, compression.
- **Cookies**: httpOnly + Secure + SameSite=None in production (cross-site
  Vercel → Render), Lax on localhost.

## Free-tier capacity notes (Vercel + Render)

The API is stateless except Mongo, so it survives restarts and scales
vertically without sticky sessions. For a single Render free instance:

- one 10-connection Mongo pool, `lean()` reads, indexed lookups only
- auth is the only hot path; no per-request DB call for `me` beyond one find
- 25 login attempts per IP per 15 min means a credential-stuffing burst is
  rejected in memory before it reaches bcrypt or Atlas
- 16 kB body cap and JSON-only responses keep memory flat
- TTL cleanup happens in Mongo, not in a background job
- Render free services sleep; point a 5-minute uptime pinger at `/health`

For 500 truly simultaneous users, put the rate-limit store in Redis (single
line change in `middleware/rateLimit.js`), raise `maxPoolSize` only as far as
your Atlas tier allows, and keep the API on a paid instance so it does not
cold-start. The frontend itself is static/ISR on Vercel and does not touch
this API except for auth.

## Deploy

**Render**
- root directory: `backend`
- build: `npm install`
- start: `npm start`
- env: `NODE_ENV=production`, `MONGO_URI`, both JWT secrets (32+ chars),
  `CLIENT_ORIGINS=https://your-app.vercel.app`

**Vercel**
- set `NEXT_PUBLIC_API_URL=https://your-api.onrender.com`
- allow that origin in `CLIENT_ORIGINS`

**Atlas**
- create a database user with read/write on the app database
- allow Render's egress (or `0.0.0.0/0` while testing)
- indexes are created by `User.init()` / `Session.init()` on boot
# zyrava-server

### Account-specific listening experience

`src/services/accountExperience.js` selects `brown-burgundy` only for the normalized
email `vimitharadottukaya@gmail.com` (verified against the existing account; the
original `gmil.com` spelling did not match an account).
All other accounts receive `standard`. Login, refresh and account responses include
this `experience` value; the web client uses it for the scoped palette and simplified
navigation. No account data or existing messages are deleted.

The personal account is excluded from community discovery, requests, conversation
lists, profiles and unread counts. Existing conversation IDs cannot be used to read,
write, mark read or send typing events involving this account. REST community access
and socket handshakes are denied for the account, so it cannot appear in online
presence. Authentication, music, playlists and the library remain available.

Deploy the API and web client together, then refresh the session to load the new
experience flag. The account email is kept on the server, not in the public client
bundle. Run `npm test` for policy and community regression checks; these use mocked
database records and do not change live accounts.

### Account customization console (web/PWA)

Authenticated standard accounts can create a look for themselves or search by name/email/phone
and propose one to another standard account. The reserved `brown-burgundy` account cannot
use the console, appear in this search, or receive changes through these endpoints.

The dedicated `/customize` page opens from the app dock and supports direct links, reloads, and browser Back.

The client provides 144 palettes, editable hex colors, four bundled dotLottie assets with
inline previews, per-screen animation selections (loading/header/fullscreen lyrics), a
loading message, and a preview isolated from the currently applied theme. Creator names
and masked contacts come from the authenticated account, never from the request body. Both the
recipient's home header and the console show this attribution.

- `GET /api/customization`: active look, pending proposals, received designs (including accepted), and designs created by this user.
- `GET /api/customization/users?q=...`: authenticated, bounded search (3–254 characters).
- `POST /api/customization/save`: retired; returns HTTP 402. Use the paid checkout endpoints below.
- `POST /api/customization/respond`: `{ id, accept, updatedAt }`. The recipient owns this
  action, and stale previews are rejected instead of applying a silently edited design.
- `POST /api/customization/reset`: `{}`. Restores the caller's default look.

Writes require CSRF and bearer authentication. Colors are six-digit hex values; animation
IDs are allowlisted, not arbitrary URLs. `Customization` has a unique creator/recipient
index; each recipient keeps a separate accepted snapshot on `User`, so editing a proposal
does not overwrite an already accepted look. A validated, cosmetic local-storage hint
allows returning devices to show the selected loading animation before session restoration;
it grants no account access and is cleared when a different/default account is restored.

Deploy server and web client together. `npm test` includes authorization, reserved-account,
validation, recipient acceptance, revision, attribution, reset, and HTTP/CSRF regression tests;
these tests use mock records and never write to production accounts.

Customization duration is optional: 1–525,600 minutes (up to 365 days), or until removed. The timer starts when a recipient applies a design; existing designs remain indefinite. Expired snapshots are excluded from authentication and customization responses, and the web app restores the original theme locally at expiry, including after returning from a background tab. Received includes accepted designs. Authenticated, CSRF-protected `POST /customization/remove` with `{ "id": "design-id" }` lets only the recipient remove a gift and clears the applied snapshot only when it matches that gift.

Customization writes are persisted in MongoDB (`customizations` proposals and `users.customization` accepted snapshots), not just in browser storage. The browser welcome hint is a disposable cache; the API reloads saved designs and the active snapshot on each authenticated session. Scrollbars throughout the web/PWA use the active theme’s thumb, hover, and track tokens.

Directory results show full usernames, mask email local-part middle characters (for example `re***t@example.com`), and expose only the last three phone digits (`•••• 210`). Phone searches accept the punctuation used during registration. The same server-side contact serializer covers sent/received designs and accepted snapshots, including legacy snapshots returned through authentication. No raw directory contacts are included in these responses, HTML attributes, or hidden controls; changing DOM text cannot reveal them. A listener's own authenticated profile still includes their own contact information. The old cosmetic welcome cache is discarded on upgrade.


### Customization checkout and admin payments (Razorpay)

Each save/apply to yourself or save/send to another account starts at **₹5 (500 paise, INR)**. Administrators can change this under **Payments → Checkout settings** (whole rupees, ₹1–₹10,000). Saving an edit is a new purchase. Recipients can accept already-paid gifts without another payment; removing a look is free. Existing designs remain usable. The server owns the price and freezes the design/recipient when creating the order.

Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` only in the backend's environment (or its ignored `.env` locally). Never put the secret in `NEXT_PUBLIC_*`, the frontend, or source control. Rotate any credentials shared in chat before production. The frontend receives only the public key ID and order data. Test mode and live mode use the same code; set matching key pairs. Local configuration is not automatically copied to hosted deployments.

- `GET /api/customization/payments`: the signed-in user's pending checkouts, without payment details or raw directory contacts.
- `POST /api/customization/payments/order`: `{ requestId, expectedAmount, recipientId, config }`; `requestId` is a UUID reused for retries of the same checkout. Returns the server-created Razorpay order with its frozen price and credential version. A stale expectedAmount is rejected with HTTP 409 before an order is created.
- `POST /api/customization/payments/verify`: `{ purchaseId, razorpay_order_id, razorpay_payment_id, razorpay_signature }`; verifies HMAC-SHA256 against the stored order, checks ownership, payment amount/currency, captured status, refund amount, and paid order status before fulfillment.
- `POST /api/customization/payments/check`: `{ purchaseId }`; queries Razorpay server-to-server for recovery when the browser callback is lost. If authorization is awaiting manual capture, the backend captures the amount saved on that order, then verifies it.
- `POST /api/customization/payments/webhook`: raw-body HMAC authentication using a **separate** `RAZORPAY_WEBHOOK_SECRET`. This endpoint intentionally does not use browser bearer auth or CSRF.

On the Razorpay Dashboard, configure `https://YOUR-API-HOST/api/customization/payments/webhook` with `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, and `refund.processed`, using the same separate webhook secret as the backend. Use the deployed HTTPS API URL; localhost cannot receive Razorpay webhooks. Without Dashboard webhook configuration, normal checkout verification and the **Check payment** recovery button work, but a closed browser's payment is not fulfilled automatically until checked. Configure the webhook when deploying both applications.

`CustomizationPurchase` retains the immutable design, owner, order/payment IDs, amount, currency, and fulfillment timestamp in MongoDB. Fulfillment commits the purchase, design, and accepted self-snapshot in one MongoDB transaction (replica set/Atlas required). Duplicate callbacks, concurrent verification, and webhook retries do not reapply a previously fulfilled design or undo a recipient's later removal. Do not delete purchase records as a cleanup job.

The Customize page fetches the current price for **Pay ₹… and apply** and **Pay ₹… and send**, alongside **Check payment** and **Resume checkout**. Checkout uses Razorpay's hosted payment fields; ZYRAVA does not store card, UPI, or bank credentials. Cancellation or failed/unconfirmed payment leaves the design unapplied. If money was debited, check the existing payment before starting another checkout.

Validation: `npm test` includes fixed-price/ownership checks, forged-signature and underpayment rejection, capture validation, rollback/retry, duplicate/concurrent fulfillment, free recipient acceptance, and signed-webhook replay. Browser tests use a mocked checkout; no live charge is part of automated testing.


The admin `/payments` page lists persisted Razorpay statuses (awaiting payment, authorized, captured, failed, checkout error, partly refunded, refunded), separately from design fulfillment. It includes payer/recipient names with masked contacts, amount, order/payment IDs, creation/fulfillment/check times, filtered totals and search. Gross captured and net-after-refunds totals are not bank settlements and do not subtract gateway fees. **Sync status** refreshes a single record from Razorpay and can fulfill an already-captured payment; it never captures an authorization or issues a refund. Refund status does not automatically revoke a recipient's theme.

- Admin-only `GET /api/admin/payments`: paginated/searchable/filterable stored records and totals.
- Admin-only `GET /api/admin/payments/settings`: price, public key ID, configuration flags and last editor/time; never secret values or encrypted credential blobs.
- Admin-only `POST /api/admin/payments/settings`: `{ amountRupees, keyId?, keySecret?, webhookSecret? }`. Send both key fields to replace credentials; omit them to retain the existing pair. New pairs pass a read-only Razorpay authentication check before anything is saved. The optional webhook secret must also be updated in Razorpay Dashboard.
- Admin-only `POST /api/admin/payments/:id/sync`: refresh one order's observed payment state.
- Authenticated `GET /api/customization/payments/config`: current price/currency and availability only.

`PaymentSettings` is the source of truth after initialization. The ignored local `.env` key pair bootstraps it once; subsequent changes are made through Admin. Secrets use AES-256-GCM encryption with a stable **PAYMENT_SETTINGS_ENCRYPTION_KEY** (32 random bytes, base64) held only in the server environment. Deploy the same key to every backend instance and keep a secure backup; do not regenerate it on restart or deployment. The admin API never sends stored secrets back to the browser. Historical encrypted key versions are retained for pending purchases; do not revoke old Razorpay keys until pending orders have been reconciled. Each purchase freezes its amount and key version, so changes apply only to new orders. Price/key changes record the admin email and update time.

Deploy the backend, music client, and admin client together. Configure the backend's encryption key before serving payment settings. Configure the Razorpay Dashboard webhook with the deployed HTTPS URL for unattended status/refund updates; without that external setup, callback verification and manual status checks still work. No real charge is performed by the test suite.

### Per-user payment history

The web/PWA sidebar includes **Payments** (`/payments`), also linked from Customize. **Admin → Users → select a user → Payments** shows the same payer-scoped history for the selected account. Each entry explains whether the charge was to save/apply a personal customization or save/send a gift, with recipient name and masked contact details, the original amount, payment and fulfillment statuses, refund amount, timestamps and Razorpay references. Incoming gifts are not charges to the recipient. Pending/failed attempts are explicitly distinguished from confirmed payments. The reserved personal account's interface remains unchanged.

- Authenticated `GET /api/customization/payments/history?page=1&limit=10`: only the signed-in user's records; no caller-supplied user ID is accepted.
- Admin-only `GET /api/admin/users/:id/payments?page=1&limit=10`: selected user's payment history.

Both endpoints return `{ items, total, page, pages, limit }`, use a maximum page size of 50, stable newest-first ordering, and `Cache-Control: no-store`. They read stored payment states without creating/capturing payments or applying designs. Purpose is stored on new purchases and derived for older records. History survives theme removal or expiry; the saved/sent label describes fulfillment at payment time, not whether the theme is currently active. Credential versions, keys, and private design configuration are never included in history responses.

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

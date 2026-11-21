import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, rename, unlink, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const REDIRECT = "http://127.0.0.1:53682/oauth2callback";
const SCOPE = "https://www.googleapis.com/auth/gmail.send";
const root = fileURLToPath(new URL("../", import.meta.url));

export function authorization(clientId) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", login_hint: "zyrava00@gmail.com", state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  return { state, verifier, url: url.toString() };
}

export function validState(actual, expected) {
  const left = Buffer.from(actual || ""), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function exchangeCode(client, code, verifier, request = fetch) {
  const response = await request("https://oauth2.googleapis.com/token", {
    method: "POST", signal: AbortSignal.timeout(20_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, client_secret: client.client_secret,
      redirect_uri: REDIRECT, code, code_verifier: verifier }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.refresh_token) throw new Error("Google did not return a refresh token. Check the OAuth client and approve offline access again.");
  if (!String(result.scope || "").split(" ").includes(SCOPE)) throw new Error("Google sending permission was not granted. Run setup again and approve Gmail sending.");
  return result.refresh_token;
}

export function renderSettings(client, refreshToken) {
  const values = {
    EMAIL_PROVIDER: "gmail", EMAIL_OTP_ENABLED: "true", GMAIL_USER: "zyrava00@gmail.com",
    GMAIL_CLIENT_ID: client.client_id, GMAIL_CLIENT_SECRET: client.client_secret, GMAIL_REFRESH_TOKEN: refreshToken,
    ADMIN_AUTH_EMAILS_ENABLED: "true", ADMIN_NOTIFICATION_EMAIL: "zyrava00@gmail.com",
  };
  // Reject control characters instead of allowing extra .env entries.
  for (const value of Object.values(values)) if (typeof value !== "string" || !value || /[\r\n\0]/.test(value)) throw new Error("Google credentials are invalid.");
  return Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n";
}

async function main() {
  const source = path.join(root, ".gmail-oauth-client.json");
  const destination = path.join(root, ".env.gmail-render");
  let client;
  try {
    const document = JSON.parse(await readFile(source, "utf8"));
    client = document.web;
    if (!client?.client_id || !client?.client_secret || !client.redirect_uris?.includes(REDIRECT)) throw new Error();
    await chmod(source, 0o600);
  } catch {
    throw new Error(`Download a Google OAuth Web application client JSON to ${source}, with authorized redirect URI ${REDIRECT}. See GMAIL_RENDER_SETUP.md.`);
  }
  const flow = authorization(client.client_id);
  let busy = false;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    const url = new URL(req.url, REDIRECT);
    if (req.method !== "GET" || url.pathname !== "/oauth2callback") { res.writeHead(404).end("Not found."); return; }
    if (!validState(url.searchParams.get("state"), flow.state)) { res.writeHead(400).end("Invalid authorization state. Return to the setup command and use its link."); return; }
    if (busy) { res.writeHead(409).end("Authorization is already being processed."); return; }
    if (url.searchParams.has("error") || !url.searchParams.get("code")) { res.writeHead(400).end("Google authorization was not completed. Use the link from your terminal to try again."); return; }
    busy = true;
    const temporary = `${destination}.${randomBytes(8).toString("hex")}`;
    try {
      const refreshToken = await exchangeCode(client, url.searchParams.get("code"), flow.verifier);
      await writeFile(temporary, renderSettings(client, refreshToken), { mode: 0o600, flag: "wx" });
      await rename(temporary, destination);
      res.end("Google authorization saved privately. Return to your terminal for the Render deployment step. No email has been sent.");
      console.log(`\nSaved private Render settings to ${destination} (owner-only permissions).`);
      console.log("Copy these settings into Render → zyrava-server → Environment, then save/redeploy. Do not paste the file into chat or Git.");
      console.log("Production email is not restored until those settings are saved in Render. No email was sent by setup.");
      clearTimeout(timeout);
      server.close();
    } catch (error) {
      await unlink(temporary).catch(() => {});
      res.writeHead(500).end("Authorization could not be saved. Restart setup and check the Google OAuth client settings.");
      console.error("Google authorization failed. No credential values were printed. Check your client, redirect URI and granted Gmail sending permission.");
      process.exitCode = 1;
      clearTimeout(timeout);
      server.close();
    }
  });
  const timeout = setTimeout(() => { console.error("Authorization timed out after 10 minutes. Run setup again."); process.exitCode = 1; server.close(); }, 10 * 60_000);
  server.on("error", () => { clearTimeout(timeout); console.error("Could not open local callback port 53682. Close the other setup process and try again."); process.exitCode = 1; });
  server.listen(53682, "127.0.0.1", () => {
    console.log("Open this Google link in your browser on THIS computer. Choose zyrava00@gmail.com and approve sending permission:");
    console.log(flow.url);
    console.log("Waiting for Google authorization. No email will be sent by this setup command.");
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

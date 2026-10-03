import http from "node:http";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const root = fileURLToPath(new URL("../frontend", import.meta.url));
const port = Number(process.env.PORT || 3000);
const databaseUrl = process.env.DATABASE_URL || "postgres://seeya:seeya_local_password@localhost:5434/seeya";
const pool = new Pool({ connectionString: databaseUrl });
const authBase = "https://auth.hackclub.com";
const cookieName = "see_ya_session";
const adminSlackIds = new Set(String(process.env.ADMIN_SLACK_IDS || "").split(",").map((id) => id.trim()).filter(Boolean));

const grants = [
  { id: "spectacles", name: "Spectacles Grant", description: "Build or buy the glasses you want to see through.", cost: 50, color: "#ff6b5f", icon: "◉", image: "/assets/spectacles-grant.jpg" },
  { id: "vr", name: "VR Grant", description: "A ticket into a world with no fixed edges.", cost: 50, color: "#a78bfa", icon: "◌", image: "/assets/vr-grant.jpg" },
  { id: "projector", name: "Projector Grant", description: "Turn a blank wall into a canvas.", cost: 50, color: "#ffd166", icon: "▱", image: "/assets/projector-grant.jpg" },
  { id: "camera", name: "Camera Grant", description: "Capture a different point of view.", cost: 50, color: "#55d6be", icon: "▣", image: "/assets/camera-grant.jpg" },
  { id: "telescope", name: "Telescope Grant", description: "Look a little further than before.", cost: 50, color: "#7dd3fc", icon: "✦", image: "/assets/telescope-grant.jpg" },
];

function airtableConfigured() {
  return Boolean(process.env.AIRTABLE_PAT && process.env.AIRTABLE_BASE_ID);
}
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function encryptionKey() {
  return createHash("sha256").update(process.env.HACKATIME_TOKEN_KEY || process.env.HACKCLUB_CLIENT_SECRET || "see-ya-local-key").digest();
}

function encryptToken(token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptToken(value) {
  const [ivValue, tagValue, encryptedValue] = String(value || "").split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new Error("Stored Hackatime token is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").filter(Boolean).map((item) => {
    const index = item.indexOf("=");
    return [item.slice(0, index).trim(), decodeURIComponent(item.slice(index + 1).trim())];
  }));
}

function setCookie(response, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  const existing = response.getHeader("Set-Cookie");
  const cookies = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  response.setHeader("Set-Cookie", [...cookies, parts.join("; ")]);
}

async function currentUser(request) {
  const token = parseCookies(request)[cookieName];
  if (!token) return null;
  const result = await pool.query(
    "SELECT u.id, u.hackclub_sub, u.name, u.email, u.hackatime_url, u.hackatime_connected, u.hackatime_user_id, u.slack_id, u.verification_status, u.ysws_eligible FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW()",
    [hash(token)]
  );
  return result.rows[0] || null;
}

function requireAuth(user, response) {
  if (user) return true;
  json(response, 401, { error: "Sign in with Hack Club to continue." });
  return false;
}

function isAdmin(user) {
  return Boolean(user?.slack_id && adminSlackIds.has(user.slack_id));
}

function requireAdmin(user, response) {
  if (isAdmin(user)) return true;
  json(response, 403, { error: "Admin access required." });
  return false;
}

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

function authSetupPage(response) {
  response.writeHead(503, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>SEE YA sign-in setup</title><style>body{font-family:system-ui;max-width:720px;margin:60px auto;padding:0 24px;line-height:1.6;background:#f4f1e9;color:#202020}h1{color:#ff6b5f}code{background:#e8e3d8;padding:3px 6px;border-radius:4px}pre{background:#202020;color:#f4f1e9;padding:18px;overflow:auto}a{color:#d95248}</style></head><body><h1>One quick setup step</h1><p>SEE YA needs a Hack Club OAuth app before builders can sign in.</p><ol><li>Open <a href="https://auth.hackclub.com/developer/apps">Hack Club Developer Apps</a>.</li><li>Create an app named <strong>SEE YA</strong>.</li><li>Set the redirect URI to <code>http://localhost:3000/auth/callback</code>.</li><li>Copy the Client ID and Client Secret into <code>see-ya/.env</code>.</li></ol><pre>HACKCLUB_CLIENT_ID=your-client-id
HACKCLUB_CLIENT_SECRET=your-client-secret
HACKCLUB_REDIRECT_URI=http://localhost:3000/auth/callback</pre><p>Restart the server after saving the file. Keep the secret private.</p></body></html>`);
}

function authErrorPage(response, message) {
  response.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>SEE YA sign-in</title><style>body{font-family:system-ui;max-width:620px;margin:80px auto;padding:0 24px;line-height:1.6;background:#fff;color:#111318}h1{color:#ef3340}a{display:inline-block;background:#111318;color:#fff;padding:12px 18px;text-decoration:none;margin-top:12px}</style></head><body><h1>Sign-in needs a fresh start</h1><p>${message}</p><a href="/?auth_error=1">Return to SEE YA</a></body></html>`);
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (id BIGSERIAL PRIMARY KEY, hackclub_sub TEXT NOT NULL UNIQUE, name TEXT NOT NULL, email TEXT, hackatime_url TEXT, hackatime_connected BOOLEAN NOT NULL DEFAULT FALSE, hackatime_token TEXT, hackatime_user_id TEXT, slack_id TEXT, verification_status TEXT, ysws_eligible BOOLEAN, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_states (state_hash TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL);
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_url TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_connected BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS hackatime_user_id TEXT;
    ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_status_check;
    ALTER TABLE submissions ADD CONSTRAINT submissions_status_check CHECK (status IN ('draft', 'pending', 'approved', 'changes_needed', 'rejected'));
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
    CREATE TABLE IF NOT EXISTS fulfillment_updates (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS project_type TEXT;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS code_url TEXT;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS demo_url TEXT;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS readme_url TEXT;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS screenshot_url TEXT;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS hackatime_project TEXT;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS hackatime_url TEXT;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS hackatime_time_url TEXT;
    ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_rgb_check;
    ALTER TABLE submissions ADD CONSTRAINT submissions_rgb_check CHECK (rgb >= 0);
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ai_used BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ai_description TEXT;
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS other_hc_program TEXT;
  `);
}

async function saveToAirtable(fields) {
  if (!airtableConfigured()) return "database";
  const table = encodeURIComponent(process.env.AIRTABLE_SUBMISSIONS_TABLE || "Submissions");
  const response = await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${table}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_PAT}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ records: [{ fields }] })
  });
  if (!response.ok) throw new Error(`Airtable returned ${response.status}`);
  return "database+airtable";
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function requestBody(request) {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new Error("Invalid JSON");
  }
}

async function api(request, response, pathname) {
  if (request.method === "GET" && pathname === "/auth/login") {
    if (!process.env.HACKCLUB_CLIENT_ID || !process.env.HACKCLUB_CLIENT_SECRET) return authSetupPage(response);
    const state = randomBytes(32).toString("hex");
    await pool.query("INSERT INTO oauth_states (state_hash, expires_at) VALUES ($1, NOW() + INTERVAL '10 minutes')", [hash(state)]);
    setCookie(response, "see_ya_oauth_state", state, { maxAge: 600 });
    const params = new URLSearchParams({
      client_id: process.env.HACKCLUB_CLIENT_ID,
      redirect_uri: process.env.HACKCLUB_REDIRECT_URI || `${process.env.PUBLIC_URL || `http://localhost:${port}`}/auth/callback`,
      response_type: "code",
      state,
      scope: "openid profile email slack_id verification_status"
    });
    return redirect(response, `${authBase}/oauth/authorize?${params}`);
  }
  if (request.method === "GET" && pathname === "/auth/callback") {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const stateCookie = parseCookies(request).see_ya_oauth_state;
    if (!code || !state || !stateCookie || state !== stateCookie) {
      setCookie(response, "see_ya_oauth_state", "", { maxAge: 0 });
      return authErrorPage(response, "That sign-in tab expired or was opened from a different local address. Return to SEE YA and start sign-in again.");
    }
    const stateResult = await pool.query("DELETE FROM oauth_states WHERE state_hash = $1 AND expires_at > NOW() RETURNING state_hash", [hash(state)]);
    if (!stateResult.rowCount) return authErrorPage(response, "That sign-in request expired. Return to SEE YA and start sign-in again.");
    const tokenResponse = await fetch(`${authBase}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: process.env.HACKCLUB_CLIENT_ID, client_secret: process.env.HACKCLUB_CLIENT_SECRET, redirect_uri: process.env.HACKCLUB_REDIRECT_URI || `${process.env.PUBLIC_URL || `http://localhost:${port}`}/auth/callback`, code, grant_type: "authorization_code" })
    });
    if (!tokenResponse.ok) return json(response, 502, { error: "Hack Club sign-in could not be completed." });
    const tokens = await tokenResponse.json();
    const profileResponse = await fetch(`${authBase}/oauth/userinfo`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!profileResponse.ok) return json(response, 502, { error: "Hack Club profile could not be loaded." });
    const profile = await profileResponse.json();
    const userResult = await pool.query(
      `INSERT INTO users (hackclub_sub, name, email, slack_id, verification_status, ysws_eligible)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (hackclub_sub) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, slack_id = EXCLUDED.slack_id, verification_status = EXCLUDED.verification_status, ysws_eligible = EXCLUDED.ysws_eligible, updated_at = NOW()
       RETURNING id`,
      [profile.sub, profile.name || profile.nickname || "Hack Club builder", profile.email || null, profile.slack_id || null, profile.verification_status || null, profile.ysws_eligible ?? null]
    );
    const session = randomBytes(32).toString("hex");
    await pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')", [hash(session), userResult.rows[0].id]);
    setCookie(response, cookieName, session, { maxAge: 60 * 60 * 24 * 30 });
    setCookie(response, "see_ya_oauth_state", "", { maxAge: 0 });
    return redirect(response, "/home");
  }
  if (request.method === "GET" && pathname === "/auth/hackatime/login") {
    const user = await currentUser(request);
    if (!user) return redirect(response, "/auth/login");
    if (!process.env.HACKATIME_CLIENT_ID || !process.env.HACKATIME_CLIENT_SECRET) {
      return json(response, 503, { error: "Hackatime OAuth is not configured. Add HACKATIME_CLIENT_ID and HACKATIME_CLIENT_SECRET to .env." });
    }
    const state = randomBytes(32).toString("hex");
    await pool.query("INSERT INTO oauth_states (state_hash, expires_at) VALUES ($1, NOW() + INTERVAL '10 minutes')", [hash(`hackatime:${state}`)]);
    setCookie(response, "see_ya_hackatime_state", state, { maxAge: 600 });
    const redirectUri = process.env.HACKATIME_REDIRECT_URI || `${process.env.PUBLIC_URL || `http://localhost:${port}`}/auth/hackatime/callback`;
    const params = new URLSearchParams({ client_id: process.env.HACKATIME_CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: "profile read", state });
    return redirect(response, `https://hackatime.hackclub.com/oauth/authorize?${params}`);
  }
  if (request.method === "GET" && pathname === "/auth/hackatime/callback") {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const user = await currentUser(request);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const stateCookie = parseCookies(request).see_ya_hackatime_state;
    if (!user || !code || !state || !stateCookie || state !== stateCookie) return json(response, 400, { error: "Invalid Hackatime connection state." });
    const stateResult = await pool.query("DELETE FROM oauth_states WHERE state_hash = $1 AND expires_at > NOW() RETURNING state_hash", [hash(`hackatime:${state}`)]);
    if (!stateResult.rowCount) return json(response, 400, { error: "This Hackatime connection request expired. Try again." });
    const redirectUri = process.env.HACKATIME_REDIRECT_URI || `${process.env.PUBLIC_URL || `http://localhost:${port}`}/auth/hackatime/callback`;
    const tokenResponse = await fetch("https://hackatime.hackclub.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.HACKATIME_CLIENT_ID, client_secret: process.env.HACKATIME_CLIENT_SECRET, code, redirect_uri: redirectUri, grant_type: "authorization_code" })
    });
    if (!tokenResponse.ok) return json(response, 502, { error: "Hackatime authorization could not be completed." });
    const tokens = await tokenResponse.json();
    if (!tokens.access_token) return json(response, 502, { error: "Hackatime did not return an access token." });
    const profileResponse = await fetch("https://hackatime.hackclub.com/api/v1/authenticated/me", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!profileResponse.ok) return json(response, 502, { error: "Hackatime profile could not be loaded." });
    const profile = await profileResponse.json();
    await pool.query("UPDATE users SET hackatime_token = $1, hackatime_user_id = $2, hackatime_connected = TRUE, hackatime_url = $3, updated_at = NOW() WHERE id = $4", [encryptToken(tokens.access_token), String(profile.id || ""), "https://hackatime.hackclub.com", user.id]);
    setCookie(response, "see_ya_hackatime_state", "", { maxAge: 0 });
    return redirect(response, "/me?hackatime=connected");
  }
  if (request.method === "POST" && pathname === "/auth/logout") {
    const token = parseCookies(request)[cookieName];
    if (token) await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hash(token)]);
    setCookie(response, cookieName, "", { maxAge: 0 });
    return json(response, 200, { ok: true });
  }
  const user = await currentUser(request);
  if (request.method === "GET" && pathname === "/api/me") {
    if (!user) return json(response, 200, { user: null });
    const stats = await pool.query("SELECT COUNT(*)::int AS projects, COALESCE(SUM(hours), 0)::numeric AS hours, COALESCE(SUM(CASE WHEN status = 'approved' THEN hours * 50 ELSE 0 END), 0)::int AS rgb FROM submissions WHERE user_id = $1 AND status IN ('pending', 'approved')", [user.id]);
    const profile = await pool.query("SELECT hackatime_url, hackatime_connected FROM users WHERE id = $1", [user.id]);
    return json(response, 200, { user: { ...user, ...profile.rows[0], is_admin: isAdmin(user) }, stats: stats.rows[0] });
  }
  if (request.method === "GET" && pathname === "/api/config") {
    return json(response, 200, { event: "SEE YA", rgbPerHour: 50, rgbToUsd: 10, airtable: airtableConfigured(), database: "postgres" });
  }
  if (request.method === "GET" && pathname === "/api/shop") return json(response, 200, { grants });
  if (request.method === "GET" && pathname === "/api/hackatime/projects") {
    if (!requireAuth(user, response)) return;
    const tokenResult = await pool.query("SELECT hackatime_token FROM users WHERE id = $1 AND hackatime_connected = TRUE", [user.id]);
    if (!tokenResult.rows[0]?.hackatime_token) return json(response, 409, { error: "Connect Hackatime first." });
    const projectsResponse = await fetch("https://hackatime.hackclub.com/api/v1/authenticated/projects", { headers: { Authorization: `Bearer ${decryptToken(tokenResult.rows[0].hackatime_token)}` } });
    if (!projectsResponse.ok) return json(response, 502, { error: "Hackatime projects could not be loaded." });
    return json(response, 200, await projectsResponse.json());
  }
  if (request.method === "GET" && pathname === "/api/projects") {
    const result = await pool.query(
      "SELECT project AS name, name AS author, link, hours, rgb, status, created_at FROM submissions WHERE status = $1 ORDER BY created_at DESC LIMIT 50",
      ["approved"]
    );
    const projects = result.rows.length
      ? result.rows.map((row) => ({ ...row, type: "SEE YA project", description: "A project shipped by a SEE YA builder." }))
      : [
          { name: "Chromatic", author: "Maya", type: "Colour tool", description: "A colour contrast playground for people who see the web differently.", hours: 12, status: "approved" },
          { name: "Wayfinder", author: "Noah", type: "Accessibility", description: "Tiny audio landmarks that make unfamiliar places easier to navigate.", hours: 18, status: "approved" },
          { name: "Afterimage", author: "Inez", type: "Vision experiment", description: "An interactive experiment about what your eyes remember after the screen goes dark.", hours: 7, status: "approved" }
        ];
    return json(response, 200, { projects });
  }
  if (request.method === "GET" && pathname === "/api/my-projects") {
    if (!requireAuth(user, response)) return;
    const result = await pool.query(
      "SELECT id, project AS name, link, hours, CASE WHEN status = 'approved' THEN hours * 50 ELSE 0 END AS rgb, status, created_at FROM submissions WHERE user_id = $1 ORDER BY created_at DESC",
      [user.id]
    );
    return json(response, 200, { projects: result.rows });
  }
  if (request.method === "GET" && pathname.startsWith("/api/submissions/")) {
    if (!requireAuth(user, response)) return;
    const id = pathname.split("/").pop();
    const result = await pool.query("SELECT id, project, project_type, description, code_url, demo_url, readme_url, screenshot_url, hackatime_project, hackatime_url, hackatime_time_url, ai_used, ai_description, other_hc_program, hours, status FROM submissions WHERE id = $1 AND user_id = $2", [id, user.id]);
    if (!result.rows[0]) return json(response, 404, { error: "Draft not found." });
    return json(response, 200, { submission: result.rows[0] });
  }
  if (request.method === "PUT" && pathname.startsWith("/api/submissions/")) {
    if (!requireAuth(user, response)) return;
    const id = pathname.split("/").pop();
    const input = await requestBody(request);
    const action = input.action === "submit" ? "pending" : "draft";
    const hackatimeProject = String(input.hackatimeProject || "").trim();
    if (action === "pending" && (!user.hackatime_connected || !hackatimeProject)) return json(response, 403, { error: "Connect Hackatime and choose a Hackatime project before submitting." });
    const project = String(input.project || "").trim();
    const projectType = String(input.projectType || "").trim();
    const description = String(input.description || "").trim();
    const codeUrl = String(input.codeUrl || "").trim();
    const demoUrl = String(input.demoUrl || "").trim();
    const readmeUrl = String(input.readmeUrl || "").trim();
    const hours = Number(input.hours);
    if (!project || !Number.isFinite(hours) || hours < 1 || hours > 200 || (action === "pending" && (!projectType || !description || !codeUrl || !demoUrl || !readmeUrl || !input.reviewConsent))) return json(response, 400, { error: "Complete the project details before submitting for review." });
    const result = await pool.query(
      `UPDATE submissions SET project = $1, link = $2, project_type = $3, description = $4, code_url = $5, demo_url = $6, readme_url = $7, screenshot_url = $8, hackatime_project = $9, hackatime_url = $10, hackatime_time_url = $11, ai_used = $12, ai_description = $13, other_hc_program = $14, hours = $15, rgb = 0, status = $16 WHERE id = $17 AND user_id = $18 AND status IN ('draft', 'changes_needed') RETURNING id, project AS name, link, hours, rgb, status, created_at`,
      [project, codeUrl, projectType || null, description || null, codeUrl || null, demoUrl || null, readmeUrl || null, input.screenshotUrl || null, input.hackatimeProject || null, input.hackatimeUrl || null, input.hackatimeTimeUrl || null, input.aiUsed === true || input.aiUsed === "true" || input.aiUsed === "on", input.aiDescription || null, input.otherHcProgram || null, hours, action, id, user.id]
    );
    if (!result.rows[0]) return json(response, 404, { error: "Only your draft can be edited." });
    return json(response, 200, { submission: result.rows[0] });
  }
  if (request.method === "GET" && pathname === "/api/leaderboard") {
    const result = await pool.query(
      "SELECT name, COALESCE(SUM(hours), 0)::numeric AS hours, COALESCE(SUM(hours * 50), 0)::int AS rgb, COUNT(*)::int AS projects FROM submissions WHERE status = 'approved' GROUP BY name ORDER BY rgb DESC, hours DESC LIMIT 100"
    );
    return json(response, 200, { leaderboard: result.rows });
  }
  if (request.method === "POST" && pathname === "/api/submissions") {
    if (!requireAuth(user, response)) return;
    const input = await requestBody(request);
    const name = String(input.name || "").trim();
    const email = user.email || "";
    const project = String(input.project || "").trim();
    const link = String(input.link || "").trim();
    const projectType = String(input.projectType || "").trim();
    const description = String(input.description || "").trim();
    const codeUrl = String(input.codeUrl || "").trim();
    const demoUrl = String(input.demoUrl || "").trim();
    const readmeUrl = String(input.readmeUrl || "").trim();
    const screenshotUrl = String(input.screenshotUrl || "").trim();
    const hackatimeProject = String(input.hackatimeProject || "").trim();
    const hackatimeUrl = String(input.hackatimeUrl || "").trim();
    const hackatimeTimeUrl = String(input.hackatimeTimeUrl || "").trim();
    const aiUsed = input.aiUsed === true || input.aiUsed === "true" || input.aiUsed === "on";
    const aiDescription = String(input.aiDescription || "").trim();
    const otherHcProgram = String(input.otherHcProgram || "").trim();
    const hours = Number(input.hours);
    const action = input.action === "submit" ? "pending" : "draft";
    if (action === "pending" && (!user.hackatime_connected || !hackatimeProject)) return json(response, 403, { error: "Connect Hackatime and choose a Hackatime project before submitting." });
    if (!email.includes("@") || !project || !Number.isFinite(hours) || hours < 1 || hours > 200 || (action === "pending" && (!projectType || !description || !codeUrl || !demoUrl || !readmeUrl))) {
      return json(response, 400, { error: "Complete the project type, description, code, demo, README, and 1–200 hours fields." });
    }
    if (action === "pending" && input.reviewConsent !== true && input.reviewConsent !== "true" && input.reviewConsent !== "on") {
      return json(response, 400, { error: "Confirm that your work and links are ready for review." });
    }
    const rgb = 0;
    const result = await pool.query(
      "INSERT INTO submissions (user_id, name, email, project, link, project_type, description, code_url, demo_url, readme_url, screenshot_url, hackatime_project, hackatime_url, hackatime_time_url, ai_used, ai_description, other_hc_program, hours, rgb, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id, name, email, project, link, hours, rgb, status, created_at",
      [user.id, user.name, email, project, link || codeUrl || "", projectType || null, description || null, codeUrl || null, demoUrl || null, readmeUrl || null, screenshotUrl || null, hackatimeProject || null, hackatimeUrl || null, hackatimeTimeUrl || null, aiUsed, aiDescription || null, otherHcProgram || null, hours, rgb, action]
    );
    const record = result.rows[0];
    let storage = "database";
    try {
      storage = await saveToAirtable({ ...record, submittedAt: record.created_at });
    } catch (error) {
      console.error("Airtable sync failed after database save:", error);
    }
    return json(response, 201, { submission: record, storage });
  }
  if (request.method === "GET" && pathname === "/api/orders") {
    if (!requireAuth(user, response)) return;
    const result = await pool.query(
      `SELECT o.id, o.grant_name, o.cost, o.quantity, o.status, o.created_at,
        COALESCE((SELECT json_agg(json_build_object('id', f.id, 'message', f.message, 'created_at', f.created_at) ORDER BY f.created_at DESC)
          FROM fulfillment_updates f WHERE f.order_id = o.id), '[]'::json) AS updates
       FROM orders o WHERE o.user_id = $1 ORDER BY o.created_at DESC`,
      [user.id]
    );
    return json(response, 200, { orders: result.rows });
  }
  if (request.method === "POST" && pathname === "/api/orders") {
    if (!requireAuth(user, response)) return;
    const input = await requestBody(request);
    const grant = grants.find((item) => item.id === input.grantId);
    if (!grant) return json(response, 400, { error: "That grant does not exist." });
    const quantity = Number(input.quantity || 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return json(response, 400, { error: "Choose between 1 and 100 items." });
    const balanceResult = await pool.query("SELECT COALESCE(SUM(CASE WHEN status = 'approved' THEN hours * 50 ELSE 0 END), 0)::int AS rgb FROM submissions WHERE user_id = $1", [user.id]);
    const spentResult = await pool.query("SELECT COALESCE(SUM(cost), 0)::int AS rgb FROM orders WHERE user_id = $1 AND status <> 'cancelled'", [user.id]);
    const available = Number(balanceResult.rows[0].rgb) - Number(spentResult.rows[0].rgb);
    const totalCost = grant.cost * quantity;
    if (available < totalCost) return json(response, 400, { error: `You need ${totalCost - available} more RGB.` });
    const result = await pool.query(
      "INSERT INTO orders (user_id, grant_id, grant_name, cost, quantity, email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, grant_id, grant_name, cost, quantity, email, status, created_at",
      [user.id, grant.id, grant.name, totalCost, quantity, user.email]
    );
    return json(response, 201, { order: result.rows[0] });
  }
  if (request.method === "GET" && pathname === "/api/admin/orders") {
    if (!requireAdmin(user, response)) return;
    const result = await pool.query("SELECT o.id, o.grant_name, o.cost, o.quantity, o.status, o.created_at, u.name, u.email, u.slack_id FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC");
    return json(response, 200, { orders: result.rows });
  }
  if (request.method === "PATCH" && pathname.startsWith("/api/admin/orders/")) {
    if (!requireAdmin(user, response)) return;
    const id = pathname.split("/").pop();
    const input = await requestBody(request);
    const status = String(input.status || "");
    if (!["requested", "fulfilled"].includes(status)) return json(response, 400, { error: "Choose Requested or Fulfilled." });
    const result = await pool.query("UPDATE orders SET status = $1 WHERE id = $2 RETURNING id, grant_name, cost, quantity, status, created_at", [status, id]);
    if (!result.rows[0]) return json(response, 404, { error: "Order not found." });
    return json(response, 200, { order: result.rows[0] });
  }
  if (request.method === "POST" && pathname.startsWith("/api/admin/orders/") && pathname.endsWith("/updates")) {
    if (!requireAdmin(user, response)) return;
    const id = pathname.split("/")[4];
    const input = await requestBody(request);
    const message = String(input.message || "").trim();
    if (!message || message.length > 1000) return json(response, 400, { error: "Write an update between 1 and 1000 characters." });
    const order = await pool.query("SELECT id FROM orders WHERE id = $1", [id]);
    if (!order.rows[0]) return json(response, 404, { error: "Order not found." });
    const result = await pool.query("INSERT INTO fulfillment_updates (order_id, message) VALUES ($1, $2) RETURNING id, message, created_at", [id, message]);
    return json(response, 201, { update: result.rows[0] });
  }
  if (request.method === "GET" && pathname === "/api/admin/submissions") {
    if (!requireAdmin(user, response)) return;
    const result = await pool.query("SELECT s.id, s.name AS submitted_name, s.email AS submitted_email, s.project, s.project_type, s.description, s.code_url, s.demo_url, s.readme_url, s.screenshot_url, s.hackatime_project, s.hackatime_url, s.hackatime_time_url, s.ai_used, s.ai_description, s.other_hc_program, s.hours, s.status, s.rgb, s.created_at, u.name, u.email, u.slack_id FROM submissions s LEFT JOIN users u ON u.id = s.user_id WHERE s.status IN ('pending', 'approved', 'changes_needed', 'rejected') ORDER BY CASE WHEN s.status = 'pending' THEN 0 ELSE 1 END, s.created_at DESC");
    return json(response, 200, { submissions: result.rows });
  }
  if (request.method === "PATCH" && pathname.startsWith("/api/admin/submissions/")) {
    if (!requireAdmin(user, response)) return;
    const id = pathname.split("/").pop();
    const input = await requestBody(request);
    const status = String(input.status || "");
    if (!["approved", "changes_needed", "rejected"].includes(status)) return json(response, 400, { error: "Invalid review status." });
    const result = await pool.query("UPDATE submissions SET status = $1, rgb = CASE WHEN $1 = 'approved' THEN hours * 50 ELSE 0 END WHERE id = $2 AND status <> 'draft' RETURNING id, project, hours, status, rgb", [status, id]);
    if (!result.rows[0]) return json(response, 404, { error: "Submission not found." });
    return json(response, 200, { submission: result.rows[0] });
  }
  return json(response, 404, { error: "Not found" });
}

async function staticFile(response, pathname) {
  const requestedPath = pathname === "/" || (!extname(pathname) && pathname !== "/app.js") ? "/index.html" : pathname;
  const file = normalize(join(root, requestedPath));
  if (!file.startsWith(root)) return json(response, 403, { error: "Forbidden" });
  try {
    const data = await readFile(file);
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(data);
  } catch {
    json(response, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) await api(request, response, url.pathname);
    else await staticFile(response, url.pathname);
  } catch (error) {
    console.error(error);
    json(response, 500, { error: "Backend or database unavailable. Start SEE YA with Docker first." });
  }
});

ensureSchema().then(() => server.listen(port, () => console.log(`SEE YA running at http://localhost:${port}`))).catch((error) => {
  console.error("Could not initialize SEE YA database:", error);
  process.exitCode = 1;
});

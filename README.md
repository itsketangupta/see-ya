# SEE YA

An independent SEE YA YSWS starter app. It includes:

- a public landing page explaining the Build → Ship → Earn RGB → Shop loop
- a responsive grant shop
- a project submission form
- a Node backend with validation and an Airtable REST adapter
- demo mode when Airtable environment variables are not configured

## Run it

```powershell
cd "$HOME\Downloads\OneDrive\Desktop\see-ya"
Copy-Item .env.example .env
npm install
docker compose up -d db
npm run dev
```

Open <http://localhost:3000>.

## Deploy it publicly

The current app is one Node service that serves both the frontend and backend. The simplest production setup is:

- **Render Web Service** for this repository
- **Neon, Supabase, or another hosted PostgreSQL provider** for the database

The local Docker database is only for development and cannot be used by a hosted deployment. On Render, create a Web Service from the repository with:

```text
Build command: npm install
Start command: npm start
```

Add these environment variables in the service settings:

```env
NODE_ENV=production
DATABASE_URL=<hosted PostgreSQL connection string>
PUBLIC_URL=https://<your-render-domain>
HACKCLUB_CLIENT_ID=<production Hack Club client id>
HACKCLUB_CLIENT_SECRET=<production Hack Club client secret>
HACKCLUB_REDIRECT_URI=https://<your-render-domain>/auth/callback
HACKATIME_CLIENT_ID=<Hackatime client id>
HACKATIME_CLIENT_SECRET=<Hackatime client secret>
HACKATIME_REDIRECT_URI=https://<your-render-domain>/auth/hackatime/callback
HACKATIME_TOKEN_KEY=<long random production secret>
ADMIN_SLACK_IDS=U093BDEP8FJ,U0AJ5J6FETU
```

Register the two HTTPS callback URLs in the Hack Club and Hackatime OAuth applications before testing sign-in. Deploy the service, open its HTTPS URL, sign in, connect Hackatime, submit a test project, and place a small test order. The database schema is initialized by the backend on startup. Do not upload `.env`, use the local Docker `DATABASE_URL`, or expose OAuth secrets in frontend code.

Vercel can host the static files, but this repository is not a Vercel-native serverless app: its current backend is a long-running Node HTTP server and needs persistent PostgreSQL. Use the single Render deployment above unless the backend is later rewritten into Vercel functions.

## Airtable setup

SEE YA has its own PostgreSQL database and does not use BEEST's database. `docker compose up -d db` creates the isolated `see_ya_postgres_data` volume, database `seeya`, user `seeya`, and schema automatically. The backend stores submissions and grant requests in PostgreSQL first. `docker compose down` stops the containers; the data volume remains. To intentionally remove only this SEE YA database data, use `docker compose down -v`.

Create a private Airtable Personal Access Token with access only to this SEE YA base. Add the token and base ID to `.env`. Airtable is an optional sync destination; it is not the primary database, and the backend never exposes the token, admin endpoints, or Airtable permissions in the browser.

The `Submissions` table needs fields named `name`, `email`, `project`, `link`, `hours`, `rgb`, and `submittedAt` (field names are case-sensitive in Airtable). The shop is currently defined in code so the public site stays usable without read access to Airtable.

## Hack Club sign-in

Create an app at <https://auth.hackclub.com/developer/apps>. For local development, set its redirect URI to `http://localhost:3000/auth/callback`; for deployment, add the real HTTPS callback URL. Copy the Client ID and Client Secret into `.env`:

```env
PUBLIC_URL=http://localhost:3000
HACKCLUB_CLIENT_ID=your-client-id
HACKCLUB_CLIENT_SECRET=your-client-secret
HACKCLUB_REDIRECT_URI=http://localhost:3000/auth/callback
```

SEE YA requests only `openid profile email slack_id verification_status`. It creates a local user record, stores only a hashed session token, and links that user to submissions and grant requests. OAuth client secrets and access tokens never go to the browser. The app does not grant access to Euan, BEEST, or anyone else.

## Hackatime connection

The Me page uses Hackatime's OAuth authorization-code flow, like BEEST. Create a server-side OAuth app at <https://hackatime.hackclub.com/oauth/applications> with the `profile` and `read` scopes, mark it confidential, and register:

```text
http://localhost:3000/auth/hackatime/callback
```

Add the OAuth credentials to `.env`:

```env
HACKATIME_CLIENT_ID=your-hackatime-client-id
HACKATIME_CLIENT_SECRET=your-hackatime-client-secret
HACKATIME_REDIRECT_URI=http://localhost:3000/auth/hackatime/callback
HACKATIME_TOKEN_KEY=use-a-long-random-private-value
```

Builders click **Connect Hackatime** on **Me**, authorize SEE YA on Hackatime, and then select one of their projects from the loaded project list. The token is encrypted at rest in SEE YA's database and is never sent to the browser. Do not request the Hackatime `admin` scope; it requires Hack Club approval and is not needed for a participant's own projects.

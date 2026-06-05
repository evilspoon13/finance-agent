# Finance Aggregator

A self-hosted personal finance dashboard: connects bank accounts via [Plaid](https://plaid.com),
stores transactions locally in Postgres, and runs a local, on-device AI (via
[Ollama](https://ollama.com)) for budgeting insights and a Q&A agent. Your financial
data never leaves your machine.

Built with Next.js 16, Drizzle ORM, and Tailwind CSS.

## Run it (one shot, with Docker)

Everything runs in containers — you only need [Docker](https://docs.docker.com/get-docker/)
(with Compose) installed.

1. **Clone and enter the repo:**

   ```bash
   git clone <repo-url> finance-aggregator
   cd finance-aggregator
   ```

2. **Create your `.env`:**

   ```bash
   cp .env.example .env
   ```

3. **Generate the token encryption key** and paste it into `.env` as `TOKEN_ENC_KEY`
   (this encrypts your Plaid access tokens at rest):

   ```bash
   openssl rand -base64 32
   ```

4. **Add your Plaid credentials** to `.env`. Create an app in the
   [Plaid dashboard](https://dashboard.plaid.com), then fill in `PLAID_CLIENT_ID`
   and `PLAID_SECRET`. Set `PLAID_ENV=production` to use your production key.

5. **Start everything:**

   ```bash
   docker compose up
   ```

   This builds the app image, starts Postgres, applies database migrations, then
   launches the app. Open <http://localhost:3000>.

That's it. Postgres data persists in a Docker volume across restarts. To stop: `Ctrl-C`,
or `docker compose down` (add `-v` to also wipe the database).

### Enabling local AI (optional)

The budgeting insights and Q&A agent use a local Ollama model. It's behind a Compose
profile because the model is a large download. To run it alongside the app:

```bash
docker compose --profile ai up
```

This starts Ollama and pulls the model named in `AI_MODEL` (default
`qwen2.5-coder:7b`) on first run. The app reaches it automatically. Without this
profile the app runs fine — AI features simply report the model server as unavailable.

## Configuration

All settings live in `.env` (see `.env.example` for the full list):

| Variable          | Required | Notes                                                            |
| ----------------- | -------- | ---------------------------------------------------------------- |
| `TOKEN_ENC_KEY`   | yes      | base64-encoded 32-byte key; `openssl rand -base64 32`            |
| `PLAID_CLIENT_ID` | yes      | from the Plaid dashboard                                         |
| `PLAID_SECRET`    | yes      | from the Plaid dashboard                                         |
| `PLAID_ENV`       | yes      | `sandbox` or `production`                                        |
| `APP_OWNER_NAME`  | no       | cosmetic; single-user app                                        |
| `AI_MODEL`        | no       | Ollama model to use (default `qwen2.5-coder:7b`)                 |

`DATABASE_URL` and `AI_BASE_URL` in `.env` are only used when running natively
(below); under Docker they're overridden to reach the `postgres` and `ollama`
containers.

## Running natively (without Docker)

If you'd rather run the Next.js dev server directly:

```bash
docker compose up -d postgres   # or point DATABASE_URL at your own Postgres
npm install
npm run db:migrate
npm run dev
```

For local AI, install [Ollama](https://ollama.com), then `ollama pull qwen2.5-coder:7b`.

## Common commands

| Command                  | What it does                          |
| ------------------------ | ------------------------------------- |
| `docker compose up`      | Build + run the whole stack           |
| `docker compose down -v` | Stop and delete the database volume   |
| `npm run dev`            | Next.js dev server (native)           |
| `npm run db:migrate`     | Apply Drizzle migrations              |
| `npm run db:studio`      | Open Drizzle Studio                   |
| `npm test`               | Run the test suite                    |

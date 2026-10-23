# Finance Aggregator

A single-user personal finance dashboard. It links your bank, card and brokerage accounts
through [Plaid](https://plaid.com), stores everything in your own Postgres, and shows:

- **Net worth** over time, and **investments** (holdings, gains, activity)
- **Budgets**: monthly spending per category against your limits, with drill-downs
- **Transactions**: searchable, and editable — recategorize, spread a lump charge over
  several months, move a charge to the month it covers, or record what friends paid back
- **Category rules**: "merchant contains X → category", applied on every sync
- **Peer-to-peer review**: tag Venmo/Zelle/Cash App payments so they count against real budgets
- **Rewards**: which card to use for what, and rewards missed by using the wrong one

It's built for one person: one username and password, set in the environment. Self-host it
on your own machine or deploy it to your own cloud account; nobody else's data is involved.

Built with Next.js 16, Drizzle ORM, Postgres and Tailwind CSS. Works on phones (add it to
your home screen).

## Configuration

Copy `.env.example` to `.env` and fill it in:

| Variable                | Required | Purpose                                                                   |
| ----------------------- | -------- | ------------------------------------------------------------------------- |
| `DATABASE_URL`          | yes      | Postgres connection string                                                |
| `DATABASE_URL_UNPOOLED` | no       | Direct (non-pooled) URL for migrations, when `DATABASE_URL` is a pooler   |
| `TOKEN_ENC_KEY`         | yes      | `openssl rand -base64 32` — encrypts Plaid tokens at rest                 |
| `AUTH_USERNAME`         | yes      | Your login                                                                |
| `AUTH_PASSWORD`         | yes      | Your password (12+ characters)                                            |
| `AUTH_SECRET`           | yes      | `openssl rand -base64 32` — signs session cookies                         |
| `PLAID_CLIENT_ID`       | yes      | From the [Plaid dashboard](https://dashboard.plaid.com)                   |
| `PLAID_SECRET`          | yes      | Your Plaid secret for `PLAID_ENV`                                         |
| `PLAID_ENV`             | no       | `sandbox` (default) or `production` for real accounts                     |
| `PLAID_WEBHOOK_URL`     | no       | `https://<your-app>/api/plaid/webhook`, for automatic updates             |
| `PLAID_REDIRECT_URI`    | no       | `https://<your-app>/connections`, required by OAuth banks in production   |
| `CRON_SECRET`           | no       | Enables `POST /api/cron/sync` for a scheduled daily sync                  |

Keep `TOKEN_ENC_KEY` with your data: a database restored under a different key can't
decrypt its Plaid tokens, and every institution would need re-linking.

## Option 1: run it on your own machine

You only need [Docker](https://docs.docker.com/get-docker/) with Compose.

```bash
git clone <repo-url> finance-aggregator && cd finance-aggregator
cp .env.example .env     # then fill it in
docker compose up --build
```

Open <http://localhost:3000> and sign in. Postgres data lives in a Docker volume
(`docker compose down -v` wipes it). Without a public URL, Plaid webhooks can't reach
you; use the **Sync** button on the Connections page instead.

## Option 2: deploy to Fly.io with a Neon database

1. **Database:** create a [Neon](https://neon.tech) project (pick the region nearest your
   Fly region). Copy both the **pooled** and the **direct** connection strings.
2. **App:** with the [Fly CLI](https://fly.io/docs/flyctl/) installed and logged in:

   ```bash
   fly launch --no-deploy --copy-config --name <app>   # app names are global
   fly secrets set \
     DATABASE_URL='<neon pooled url>' \
     DATABASE_URL_UNPOOLED='<neon direct url>' \
     TOKEN_ENC_KEY="$(openssl rand -base64 32)" \
     AUTH_USERNAME='you' AUTH_PASSWORD='<a long password>' \
     AUTH_SECRET="$(openssl rand -base64 32)" \
     PLAID_CLIENT_ID='…' PLAID_SECRET='…' PLAID_ENV=production \
     PLAID_WEBHOOK_URL='https://<app>.fly.dev/api/plaid/webhook' \
     PLAID_REDIRECT_URI='https://<app>.fly.dev/connections' \
     CRON_SECRET="$(openssl rand -hex 32)"
   fly deploy
   ```

   Each deploy runs database migrations first (`release_command` in `fly.toml`). The
   machine sleeps when idle and wakes on the next request or Plaid webhook.
3. **Plaid:** add `https://<app>.fly.dev/connections` to the allowed redirect URIs in the
   Plaid dashboard. Linked items are pointed at `PLAID_WEBHOOK_URL` automatically on the
   next sync.
4. **Daily sync** (optional, also records the daily net-worth point): a scheduled machine
   that calls the cron endpoint once a day.

   ```bash
   fly machine run curlimages/curl:8.10.1 --app <app> --region lax --schedule daily \
     --restart no --env CRON_SECRET='<same CRON_SECRET>' --entrypoint sh -- -c \
     'curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>.fly.dev/api/cron/sync'
   ```

### Moving an existing database

```bash
pg_dump -Fc --no-owner --no-acl "<old database url>" > finance.dump
pg_restore --no-owner --no-acl -d "<neon direct url>" finance.dump
```

Then set the **same** `TOKEN_ENC_KEY` as the old install, and deploy: migrations pick up
from where the old database left off.

## Development

```bash
npm install
docker compose up -d postgres   # Postgres on localhost:5433
npm run db:migrate
npm run dev                     # http://localhost:3000
```

| Command               | What it does                                         |
| --------------------- | ---------------------------------------------------- |
| `npm test`            | Unit tests (Vitest)                                  |
| `npm run lint`        | ESLint                                               |
| `npm run sync`        | Sync every linked item from the command line         |
| `npm run db:generate` | Generate a migration after editing `lib/db/schema.ts` |
| `npm run db:migrate`  | Apply migrations                                     |
| `npm run db:studio`   | Browse the database                                  |

### How spending is counted

Categories come from Plaid's `personal_finance_category`. Your overrides live in their own
columns on `transactions` (`user_category`, `user_memo`, `budget_month`, `amortize_months`,
`reimbursed_cents`), which sync never touches. The rules for what counts as spending are
defined once, in `lib/db/spend-sql.ts`, and every view uses them. Transfers and credit-card
payments are not spending; peer-to-peer payments count once you give them a category.

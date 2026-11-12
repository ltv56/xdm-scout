# Manual test: send core

Sends one real DM from the connected account to a recipient and checks the ledger.

## Prerequisites

- Database running: `docker compose up -d db`, then `npm run db:migrate -w apps/api`.
- `.env` with `X_MODE=live`, `X_CLIENT_ID`, `X_CLIENT_SECRET` and `TOKEN_KEY` (`openssl rand -base64 32`).
- Callback `http://localhost:3000/api/auth/x/callback` registered in the X app.
- The recipient is a second account you control and has sent the sender account a DM in the last 30 days asking to talk. API sending only goes to people who messaged first.

## 1. Start

```
npm run build -w apps/api
npm run dev -w apps/web
cd apps/api && node dist/main.js
```

The web app on port 3000 proxies `/api` to the api on port 3001.

## 2. Connect the sender account

Open `http://localhost:3000/api/auth/x/login`, log in as the sender and authorize.
The page shows `X account connected.` and `sender_accounts` has one row with encrypted tokens.

## 3. Seed a recipient and a draft

```
docker exec xdm-scout-db-1 mysql -uxdm -pxdm xdm -e "
INSERT INTO x_users(xUserId, handle) VALUES ('<RECIPIENT_ID>', '<handle>');
INSERT INTO contacts(id, senderAccountId, xUserId, recipientPermission, invitationEventId, invitationAt)
  VALUES (10, (SELECT id FROM sender_accounts LIMIT 1), '<RECIPIENT_ID>', 'requested_dm', '<DM_EVENT_ID>', NOW(3));
INSERT INTO drafts(id, contactId, content) VALUES (12, 10, 'Hi from xdm-scout phase 1 test');"
```

## 4. Approve

```
HASH=$(printf 'Hi from xdm-scout phase 1 test' | sha256sum | cut -d' ' -f1)
curl -XPOST localhost:3001/api/drafts/12/approve -H 'content-type: application/json' -d "{\"contentHash\":\"$HASH\"}"
```

- First call: `201 {"attemptId":N}`, attempt `queued`.
- Second call: `409 Already queued`.
- A hash that does not match the draft: `409 Draft changed after you reviewed it`.
- A contact with `recipientPermission` `none` or no `invitationEventId`: `403 API sending is limited to people who messaged you first. This person hasn't.`
- A contact with `invitationAt` older than 30 days: `403 Their invitation is older than 30 days. Send it yourself in X.`

`<DM_EVENT_ID>` is the id of the recipient's DM; set it by hand until the app records confirmed invitations.

## 5. Run the worker

```
cd apps/api && node dist/worker-main.js
```

Check:

```
docker exec xdm-scout-db-1 mysql -uxdm -pxdm xdm -e "SELECT id, status, error, xEventId FROM send_attempts"
```

- `sent` with an `xEventId`; the DM is in the recipient's inbox.
- The worker reads only the latest message of the conversation before sending. If it is the recipient's DM, the reply is sent.
- If the latest message is one you sent by hand in X: `failed`, `Someone already replied outside xdm-scout`, and nothing is sent.
- If the worker stops after X accepted the DM but before the result is saved, the attempt stays `sending`. On the next worker start it becomes `unknown`, and about a minute later reconciliation finds the message on X and sets `sent`.

## 6. Discovery from a handle list (fake mode)

Start the API and the worker with `X_MODE=fake`. Profiles come from `fixtures/profiles.json`.

```
curl -XPOST localhost:3001/api/campaigns -H 'content-type: application/json' \
  -d '{"name":"robotics demo","keywords":["robotics","llm","embodied"],"handles":["mina_builds","@tomas_agents","lena_embodied","robotco","private_dev","pasta_daily","nobody_here"]}'
curl -XPOST localhost:3001/api/campaigns/1/discover
curl localhost:3001/api/campaigns/1/prospects
```

Cost estimate before running, and spend after:

```
curl localhost:3001/api/campaigns/1/estimate
docker exec xdm-scout-db-1 mysql -uxdm -pxdm xdm -e "SELECT campaignId, kind, count, costMicros FROM api_usage"
```

- `costMicros` is in millionths of a dollar. Prices are in `apps/api/src/discovery/pricing.ts`.
- `budgetUsd` on the campaign (default 1) caps the spend. Discovery stops when the next profile reads or a full 15-post read does not fit, keeps what it has, and the skipped handles get reason `budget`.
- Prospects: `mina_builds`, `tomas_agents`, `lena_embodied`.
- Skipped: `robotco` (organization), `private_dev` (protected), `pasta_daily` (bio has no keyword), `nobody_here` (not found).
- A body without `name`, `keywords` or `handles`: `400`.
- Profiles fetched less than 7 days ago are not fetched again.

## 7. Fit scoring (fake mode)

Needs a campaign with prospects from section 6 and the worker running. Without `LLM_API_KEY` and `LLM_MODEL` in `.env` a canned stand-in answers: every Fit is `possible`, the opening is the latest stored post.

```
curl -XPOST localhost:3001/api/campaigns/1/score
curl localhost:3001/api/campaigns/1/prospects
```

- `score` returns `{"queued":N}` for prospects without a score; a second call returns `{"queued":0}`.
- Each prospect has `fit`, `role`, `areas`, `opening` (`type`, `summary`, `freshness` fresh/stale/expired, `url`) and `claims` with `status` verified/inferred and evidence links.
- Order: Fit (strong, possible, weak, not a fit, not scored), then newest opening.
- The web app shows the same list: `npm run dev -w apps/web`, campaign number in the box.

With a real model, set in `.env`:

```
LLM_PROVIDER=openai        # or anthropic
LLM_BASE_URL=https://...   # OpenAI-compatible base URL, ignored for anthropic
LLM_MODEL=...
LLM_API_KEY=...
```

## 8. Retention of X data

The worker sweeps on start and every hour:

- Post text in `x_posts` is cleared once every prospect of that person is scored; id and date stay. Discovery reads the posts again if needed.
- Post evidence that no claim or opening cites is deleted.
- After 7 days, `x_users` name, bio and followers and `evidence` excerpts are cleared unless the person has a `pending` or `approved` draft; ids, handle and links stay.

```
docker exec xdm-scout-db-1 mysql -uxdm -pxdm xdm -e "SELECT xUserId, LEFT(text, 20) FROM x_posts; SELECT id, LEFT(excerpt, 20) FROM evidence"
```

## Automated tests

```
npm test -w apps/api
```

Runs against MySQL on schema `xdm_test`.

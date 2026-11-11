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

- Prospects: `mina_builds`, `tomas_agents`, `lena_embodied`.
- Skipped: `robotco` (organization), `private_dev` (protected), `pasta_daily` (bio has no keyword), `nobody_here` (not found).
- A body without `name`, `keywords` or `handles`: `400`.
- Profiles fetched less than 7 days ago are not fetched again.

## Automated tests

```
npm test -w apps/api
```

Runs against MySQL on schema `xdm_test`.

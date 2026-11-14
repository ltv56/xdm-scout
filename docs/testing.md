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
# the worker picks the job up within a few seconds; wait until lastDiscovery is set
curl localhost:3001/api/campaigns/1
curl localhost:3001/api/campaigns/1/prospects
```

- `GET /api/campaigns/1` returns the campaign with `lastDiscovery`: time, `added`, `skipped` (handle and reason), `spentMicros`, `stoppedByBudget`, `postsPending`.
- A second `discover` while one is pending or running: `{"queued":false,"reason":"Discovery is already running for this campaign"}`.
- An unknown campaign id: `404`.

Cost estimate before running, and spend after:

```
curl localhost:3001/api/campaigns/1/estimate
docker exec xdm-scout-db-1 mysql -uxdm -pxdm xdm -e "SELECT campaignId, kind, count, costMicros FROM api_usage"
```

- `costMicros` is in millionths of a dollar. Prices are in `apps/api/src/discovery/pricing.ts`.
- `budgetUsd` on the campaign (default 1) caps the spend. Discovery stops when the next profile reads or a full 15-post read does not fit, keeps what it has, and the skipped handles get reason `budget`.
- Prospects: `mina_builds`, `tomas_agents`, `lena_embodied`.
- Skipped: `robotco` (organization), `private_dev` (protected), `pasta_daily` (bio has no keyword), `nobody_here` (not found).
- A body without `name` or `keywords`, or with no `handles`, `seeds` or `queries`: `400`.

From seed accounts (fake mode, `fixtures/following.json`):

```
curl -XPOST localhost:3001/api/campaigns -H 'content-type: application/json' \
  -d '{"name":"seeds demo","keywords":["robotics","llm","embodied"],"seeds":["sea_robotics_lab","ai_builders_sg"]}'
curl localhost:3001/api/campaigns/<id>/estimate
curl -XPOST localhost:3001/api/campaigns/<id>/discover
curl localhost:3001/api/campaigns/<id>/prospects
```

- Prospects are the people the seeds follow, `relationship` `adjacent`, with `seedCount`: `mina_builds` and `tomas_agents` 2, `lena_embodied` 1. Seeds themselves are not prospects.
- `pasta_daily` and `robotco` are skipped (bio, organization).
- Following reads cost about $0.01 per user returned and stop at 200 per seed or at the budget. The estimate gives the upper bound (`maxFollowing`); posts of people found through seeds are not in the estimate and are capped by the budget.

From recent search (fake mode, `fixtures/search.json`; X search covers the last 7 days):

```
curl -XPOST localhost:3001/api/campaigns -H 'content-type: application/json' \
  -d '{"name":"search demo","keywords":["robotics","embodied"],"queries":["(\"robot arm\" OR manipulation) (open-sourced OR released) -is:retweet"]}'
curl -XPOST localhost:3001/api/campaigns/<id>/discover
curl localhost:3001/api/campaigns/<id>/prospects
```

- Prospects: `mina_builds`, `lena_embodied` (`relationship` `cold`); `pasta_daily` skipped (bio).
- Each query reads up to 50 posts; posts and authors are billed (`api_usage` kinds `search` and `profile`). A query is skipped when the budget cannot pay for 10 results.
- Profiles fetched less than 7 days ago are not fetched again.

## 7. Fit scoring (fake mode)

Needs a campaign with prospects from section 6 and the worker running. Without `LLM_MODEL` in `.env` a canned stand-in answers: every Fit is `possible`, the opening is the latest stored post.

```
curl -XPOST localhost:3001/api/campaigns/1/score
curl localhost:3001/api/campaigns/1/prospects
```

- `score` returns `{"queued":N}` for prospects without a score; a second call returns `{"queued":0}`.
- Each prospect has `fit`, `role`, `areas`, `opening` (`type`, `summary`, `freshness` fresh/stale/expired, `url`) and `claims` with `status` verified/inferred and evidence links.
- Each prospect also has `lastPostAt` (latest stored post) and `criteria`: the campaign's own lines, each `met`, `not_met` or `unknown`. Met and not met need cited evidence that passes the second check; the canned stand-in leaves every line `unknown`.
- Campaign criteria are set at creation, up to 5 lines: `"criteria":["Based in or building for Southeast Asia","Ships code or papers"]`.
- Order: Fit (strong, possible, weak, not a fit, not scored), then how many seeds follow them, then newest opening.
- The web app shows the same list: `npm run dev -w apps/web`, campaign number in the box.

With a real model, set in `.env`:

```
GOOGLE_API_KEY=           # also OPEN_ROUTER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY; leave unused ones empty
LLM_MODEL=gemini-4-hydrogen
DECISION_MODEL=gemini-decision-1
```

`claude-*`, `gpt-*` and `gemini-*` names use their own key first, then OpenRouter; a `vendor/model` name goes to OpenRouter. `DECISION_MODEL` takes `gemini-decision-1` (Google), a System One model on OpenRouter (`typesafe/jev-1.14`), or any text model. Empty: the text model answers, or fixtures if `LLM_MODEL` is empty too.

## 8. Retention of X data

The worker sweeps on start and every hour:

- Post text in `x_posts` is cleared once every prospect of that person is scored; id and date stay. Discovery reads the posts again if needed.
- Post evidence that no claim or opening cites is deleted.
- After 7 days, `x_users` name, bio and followers and `evidence` excerpts are cleared unless the person has a `pending` or `approved` draft; ids, handle and links stay.

```
docker exec xdm-scout-db-1 mysql -uxdm -pxdm xdm -e "SELECT xUserId, LEFT(text, 20) FROM x_posts; SELECT id, LEFT(excerpt, 20) FROM evidence"
```

## Review with real data (fake X, canned LLM)

Start the API and the worker with `X_MODE=fake`. Without `LLM_MODEL` the draft text is a fixed template built from the person's opening post, so no model is called.

```
B=http://localhost:3001/api; J='content-type: application/json'
curl -XPOST $B/auth/x/fake                                        # fake mode only: made-up sender @sandbox_sender, no X call; 404 with X_MODE=live
curl -XPUT $B/sender-profile -H "$J" -d '{"intro":"GenAI Fund backs early AI founders in Southeast Asia.","programs":[{"id":1,"name":"Intro to investors","description":"Intro to investors","link":"https://genaifund.ai/","deadline":null}],"signer":"Vinh","sampleMessages":[]}'
# create a campaign, discover and score as in section 6 and 7, then:
curl $B/campaigns/1/drafts/ready                                  # {"ready":N}
curl -XPOST $B/campaigns/1/drafts -H "$J" -d '{"limit":3}'        # {"drafted","readyToDraft","noOpening"}; the worker writes the drafts
curl -XPOST $B/campaigns/1/prospects/5/draft                      # one person from Candidates; 409 says why not
curl -XPOST $B/campaigns/1/prospects/6/dismiss -H "$J" -d '{"reason":"weak_opening"}'
curl "$B/review-queue?campaignId=1"                               # drafts with checks, evidence, weakest point, Open in X link
curl -XPOST $B/drafts/1/approve -H "$J" -d '{"contentHash":"<contentHash from the queue>","confirmedUnbacked":true}'
```

- Nothing is drafted by scoring; drafts exist only after the calls above.
- A stale `contentHash` answers `409`; a draft with a blocking check answers `409` until it is edited.
- Skip, dismiss, approve, regenerate and Do not contact add a row to `review_signals` (no handle).

## Inbox: Check in X

After approving drafts as above:

```
curl -XPOST $B/drafts/1/manual -H "$J" -d '{"outcome":"sent"}'  # "I sent it": the send waits in Check in X
curl "$B/inbox/checks?campaignId=1"                               # {"toCheck":[...],"delivered":[...]}
curl -XPOST $B/send-attempts/1/confirm -H "$J" -d '{"outcome":"sent"}'      # Delivered, verifiedBy "operator"
curl -XPOST $B/send-attempts/2/confirm -H "$J" -d '{"outcome":"not_sent"}'  # draft goes back to Review
```

- Check in X lists sends marked as sent by hand that the API has not seen, and API sends X never confirmed (`needs_decision`).
- Confirming a send that is not waiting for a check answers `409`.

## Inbox: replies

The worker reads each delivered chat: every 30 min for the first 6 h after the send, then every 3 h, and stops after 3 days or at the first reply. It queues at most one read per minute. Each read asks X for the newest message only and adds one `dm_event` row to `api_usage`.

```
curl "$B/inbox/checks?campaignId=1"            # "replies":[{replyId, theirText, ourText, handled, replyClass, classBy, doNotContact, openInX}], delivered[].replied
curl -XPOST $B/replies/1/handled               # handled; 409 the second time
curl -XPOST $B/replies/1/class -H 'content-type: application/json' -d '{"replyClass":"Opt-out"}'   # classBy operator; Not interested / Opt-out add do_not_contact; 400 unknown class, 404 unknown reply
curl -XPOST "$B/inbox/check-now?campaignId=1"  # {"queued":N,"estimatedMicros":N*10000}; the worker reads those chats now
curl -XPOST $B/send-attempts/1/replied         # "They replied": reply without text for an encrypted chat; 409 if not delivered or already replied
docker exec xdm-scout-db-1 mysql -uxdm -pxdm xdm -e "SELECT id, repliesReadAt FROM contacts; SELECT * FROM jobs WHERE type = 'read_replies'"
docker exec xdm-scout-db-1 mysql -uxdm -pxdm xdm -e "SELECT id, replyClass, classBy, handledAt FROM replies; SELECT * FROM do_not_contact"
```

- Each reply with text gets a class when it is stored. A stop phrase (stop messaging, unsubscribe, remove me, don't message, leave me alone) is `Opt-out` by rule, with no LLM call. Anything else goes to the LLM (task `reply`). Below 0.7, or bad JSON twice, it is `Unclear`. In fake mode with no LLM key, every reply the rule does not catch is `Unclear`.
- `Not interested` and `Opt-out` add the person to `do_not_contact` (source `reply`) and close the reply. `Not now` closes it. Open replies list Interested first, then Question.
- The operator can change the class on the card. Moving a reply out of `Not interested` or `Opt-out` keeps the person in `do_not_contact`.
- The fake X keeps its messages in the worker's memory, so a fake reply cannot be sent from outside. The browser test writes a row into `replies` instead.

## Browser walkthroughs (web)

Playwright in `apps/web/e2e` with its own `package.json` and `node_modules`: New campaign, Candidates, Review, Inbox, a phone-sized screen, and the error and empty states. It drives the installed Edge, so no browser is downloaded. The API and the worker run in fake mode on the database `xdm_e2e`:

```
docker exec xdm-scout-db-1 mysql -uxdm -pxdm -e "CREATE DATABASE IF NOT EXISTS xdm_e2e"   # once
cd apps/api
export DATABASE_URL='mysql://xdm:xdm@127.0.0.1:3306/xdm_e2e?allowPublicKeyRetrieval=true'
npx typeorm -d dist/data-source.js migration:run
X_MODE=fake PORT=3021 node dist/main.js
X_MODE=fake PORT=3021 node dist/worker-main.js
cd ../web/e2e
npm install                         # once
E2E_API_URL=http://localhost:3021 npm run e2e
```

- Before the tests, `global-setup.ts` empties every table of `E2E_DATABASE_URL` (default `xdm_e2e`) except `migrations`. It refuses a database whose name does not end in `_e2e`.
- The tests create the `robotics demo` campaign through the API and wait for discovery and scoring on the fake X.
- Review, Inbox and the phone-sized test each create their own campaign, connect the fake sender (`POST /api/auth/x/fake`) and wait for the worker to write the drafts.
- Inbox empties the database again when it ends: it marks people as sent, and the fake X has only three people to draft for. Its reply tests write rows into `replies` and `do_not_contact` directly.
- Vite starts on port 3020 (`E2E_WEB_PORT`) and proxies `/api` to `E2E_API_URL`.

## Automated tests

```
npm test -w apps/api
```

Runs against MySQL on schema `xdm_test`.

## Eval over the labelled fixtures

Run from `apps/api` after `npx tsc -p tsconfig.build.json`. The model name goes through the same routing as `DECISION_MODEL` (`gemini-decision-1`, `gpt-6-luna`, any text model such as `gpt-5-nano` or `deepseek-flash`).

```
node scripts/eval.cjs --model <name> [--limit N]      # ask every labelled question, print Brier, precision and coverage
node scripts/eval-import.cjs <name> <answers.json>... # store answers copied from a chat app as if they were a model run
node scripts/eval-compare.cjs [--only a,b]            # all cached models side by side on the same questions
node scripts/eval-ensemble.cjs <a> <b>                # two models alone, averaged, and with the "both agree" rule
```

`--target` (eval and eval-compare, default 0.9) picks, per question, the lowest threshold from 0.50 to 0.95 whose 95% lower bound on precision reaches the target on the first half of the fixtures, with at least 10 yes answers; the second half reports precision and coverage at it. `none (0.7)` means no threshold passed. `--limit` keeps that many items per question. `fixture` answers 0.5 for everything. Answers are cached in `.local/eval/<name>.json`, so a rerun asks only what is missing; a 429 is retried up to five times. Reports are written to `.local/eval/`.

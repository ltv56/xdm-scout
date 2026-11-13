# Eval fixtures

Made-up data, English only. No real people, no X text. Batch 1 (no `batch` field) is the first 30 profiles, 100 DMs and 100 drafts. Batch 2 (`batch: 2`) adds 30 profiles, 200 DMs and 200 drafts with more variety: short, long, lowercase and emoji messages, tricky cases (prompt injection, "stop" used in another sense, an opt-out hidden in a question) and subtler draft faults (a number changed from the evidence, a sensitive remark inside the intro).

- `profiles.json`: 60 profiles. Labels: `own_account` (profile looks like the person's own account), `fits_segment`.
- `dms.json`: 300 inbound DMs in groups (`clear_invite`, `vague_invite`, `neutral`, `decline`, `spam`, and `tricky` in batch 2). Labels: `invitation`, `opt_out`, `reply_class`.
- `drafts.json`: 300 drafts with the evidence post. 120 clean, 45 per planted fault (`planted`: `one_person`, `no_sensitive`, `no_familiarity`, `claim_backed`). Labels: one yes/no per check.

Every label is answered and every item has `reviewed: true`. A label stands when at least 6 of 7 chats gave the same answer and it matches how the item was made; every other label was decided by a person, with the chats' votes in front of them. Batch 1 rows were filled by the owner. Batch 2 rows were proposed by the assistant and not yet checked by the owner.

- Profiles: `own_account` is false for parody, fan and unaffiliated accounts.
- DMs: `invitation` is true when the sender asks us something and waits for an answer (a question about the fund, its programme or team, an application, "not sure we qualify"). It is false for spam, thanks, declines and "ping me later". `reply_class` uses the classes of the reply table; a message that is both Interested and Question is labelled `Interested|Question` and either answer is correct. A DM with stop, unsubscribe, remove me or don't contact is an opt-out.
- Drafts: a planted fault makes its own check `false`. `claim_backed` is also `false` when the draft says something about the recipient that the evidence does not (illness, debt, faith, politics, "you look like one"); the sensitive remark itself still fails `no_sensitive`.

`planted` and the group names only describe how the data was made. Labels derived from them show whether a model catches the faults we wrote, not the faults a model makes on its own.

## Checking the labels with several chats
Run from `apps/api` after `npx tsc -p tsconfig.build.json`.

1. `node scripts/eval-labels.cjs export <dir> [--batch N]` writes the prompt files (profiles and DMs in parts of up to 130 items, drafts in parts of 50). They carry no labels, groups or fault markers, and DMs and drafts are shuffled in a fixed order.
2. Paste each file into a separate chat, one chat per labeller, and save each answer as `<labeller>-<part>.txt` (for example `chatgpt-1.txt`, `chatgpt-2.txt`) in one folder.
3. `node scripts/eval-labels.cjs merge <answers> <out> [--batch N] [--quorum N]` compares the answers with the prefilled labels and writes `<out>/to-label.csv`. A label is kept only when at least `--quorum N` labellers gave the same answer (default: all of them) and it matches the prefill; a labeller is the name before the first `-` in an answer file. Anything else, including a missing answer, is listed with each labeller's vote.
4. Fill the `human` column of the CSV (yes, no, or a reply class) and run `merge ... --human <csv> --write`. Without `--write` nothing in `fixtures/eval` changes.

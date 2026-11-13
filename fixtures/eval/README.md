# Eval fixtures

Made-up data. No real people, no X text.

- `profiles.json`: 30 profiles. Labels: `own_account` (profile looks like the person's own account), `fits_segment`.
- `dms.json`: 100 inbound DMs in five groups of 20 (`clear_invite`, `vague_invite`, `neutral`, `decline`, `spam`). Labels: `invitation`, `opt_out`, `reply_class`.
- `drafts.json`: 100 drafts with the evidence post. 40 clean, 15 per planted fault (`planted`: `one_person`, `no_sensitive`, `no_familiarity`, `claim_backed`). Labels: one yes/no per check.

Labels are prefilled from how each item was made, not by reading it. `reviewed` is `false` until a person has checked the item; set it to `true` after checking and fix the label if it is wrong. `null` means nobody decided yet.

- Profiles: `own_account` is false for parody, fan and unaffiliated accounts. `fits_segment` is `null` for four borderline people (`maya_mlops`, `rob_official`, `dr_ana`, `rina_ops`).
- DMs: `invitation` follows the group. The 20 `vague_invite` DMs stay `null`: decide each one. `reply_class` uses the classes of the reply table (Interested, Question, Not now, Not interested, Opt-out, Unclear); it is `null` for `spam` and `vague_invite`. A DM with stop, unsubscribe, remove me or don't contact is an opt-out.
- Drafts: a planted fault makes its own check `false` and the others `true`. For `no_familiarity` drafts `claim_backed` is `null`, because a made-up meeting is also an unbacked claim.

`planted` and the group names only describe how the data was made. Labels derived from them show whether a model catches the faults we wrote, not the faults a model makes on its own.

## Checking the labels with several chats
Run from `apps/api` after `npx tsc -p tsconfig.build.json`.

1. `node scripts/eval-labels.cjs export <dir>` writes three prompt files (profiles and DMs, drafts in two parts). They carry no labels, groups or fault markers.
2. Paste each file into a separate chat, one chat per labeller, and save each answer as `<labeller>-<part>.txt` (for example `chatgpt-1.txt`, `chatgpt-2.txt`, `chatgpt-3.txt`) in one folder.
3. `node scripts/eval-labels.cjs merge <answers> <out>` compares the answers with the prefilled labels and writes `<out>/to-label.csv`. A label is kept only when every labeller gave the same answer and it matches the prefill. Anything else, including a missing answer, is listed with each labeller's vote.
4. Fill the `human` column of the CSV (yes, no, or a reply class) and run `merge ... --human <csv> --write`. Without `--write` nothing in `fixtures/eval` changes.

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

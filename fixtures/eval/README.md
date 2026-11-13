# Eval fixtures

Made-up data. No real people, no X text.

- `profiles.json`: 30 profiles. Labels: `own_account` (profile looks like the person's own account), `fits_segment`.
- `dms.json`: 100 inbound DMs in five groups of 20 (`clear_invite`, `vague_invite`, `neutral`, `decline`, `spam`). Labels: `invitation`, `opt_out`, `reply_class`.
- `drafts.json`: 100 drafts with the evidence post. 40 clean, 15 per planted fault (`planted`: `one_person`, `no_sensitive`, `no_familiarity`, `claim_backed`). Labels: one yes/no per check.

All `labels` start as `null`; fill them with `true` or `false` by reading each item. `planted` is only a hint for the reviewer, not a label.
Planted faults only show whether a model catches faults we wrote, not faults an LLM makes.

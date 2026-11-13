# Design

Operate surface: a reviewer clears about ten drafts in one sitting and must see within seconds what to do next.

## Principles
- Apple-like and minimal: neutral light grey page, one white floating panel, a quiet top bar of plain text, near-black primary actions, hairline separators, tinted fills for status.
- Review reads as a macOS toolbar over a document. Toolbar: arrows to move between drafts, the person's name opening a drop-down list of the whole queue, then Skip and the single filled button (Approve). Reasons appear in a tinted notice row under the toolbar.
- Controls sit next to what they act on. Edit message and Write a new draft sit directly under the draft text, and editing replaces the text in place. The toolbar holds only decisions about the person.
- The verdict (Ready, Check, Confirm, Fix) is a status chip with an icon beside the Fit mark, never in the toolbar, so it cannot be read as a button.
- Body, in priority order: Fit and verdict -> person -> draft (20px) -> weakest point -> About the person (dated counts with sample size, criteria) -> Model checks (probabilities, never a reason); evidence, who sends it and the preview sit in a quiet column on the right. Do not contact is a quiet link at the very bottom.
- Overview answers "what did it already do, what needs me, what did it cost": next step, people found by fit, best matches with the specific reason, last search with spend, Search again.
- Verdict words (Ready, Check, Confirm, Fix) are identical in the queue list and the chip.

## Tokens
Defined in `src/index.css`.
- Surfaces: `paper` #f5f5f7 (page), `raised` white (panel), `rail` quiet fills.
- Text: `ink` #1d1d1f, `muted` #63636b. All text pairs are at least 4.5:1.
- Accent near-black #1d1d1f: the primary action, the active tab and the focus ring. No blue anywhere; colour means status only. Text greens and reds are `ok` #087529 and `block` #c42318 (at least 4.5:1 on their tints).
- Status colors follow the usual meaning: `ok` green (Ready, criteria met), warn yellow (check, ink text on a lemon fill), block red (fix, not a fit). Fresh tinted fills; status is always written as a word.
- Fit: green #34c759 (strong), yellow #ffcc00 (possible), grey (weak), red (not a fit), dashed grey (not scored). Shapes differ too: full circle, half circle, empty ring, ring with a slash, dashed ring.

## Type
Be Vietnam Pro (OFL), weights 400-700, self-hosted in `src/fonts`; covers Vietnamese names. Draft text is 18px/1.75.

## Components
Shared class strings in `src/ui.ts`: toolbar, approve, primary and secondary buttons, text links, fields, chips. Icons: three chevrons in `src/icons.tsx`, one stroke weight.
Routine steps (edit, regenerate, skip, do not contact) open inline above the buttons, never in a modal. Keyboard: J/K move between drafts, A approve, E edit, S skip.

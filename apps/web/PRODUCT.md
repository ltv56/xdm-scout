# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One reviewer at a small fund (GenAI Fund, Southeast Asia) who clears about ten drafted DMs per sitting. They know the AI and robotics scene, are accountable for every message sent, and need to judge each draft against the evidence in under a minute.

## Product Purpose
xdm-scout finds AI and robotics people on X, drafts DMs backed by their own posts, and sends only after a human approves that exact text. Success: a reviewer approves or rejects each draft with confidence, and nothing goes out that is not backed by a real post.

## Positioning
Every sentence of a draft traces to a post, to the sender profile, or is marked as having no source. Fit, Relationship and Permission are three separate facts, never one score.

## Capabilities and Constraints
- Review actions: Approve, Edit, Regenerate, Skip (with reason), Do not contact.
- Two send paths: "Send from xdm-scout" (only to people who messaged first) and "Send it yourself in X" (copy the DM, open the X compose screen, then report "I sent it" or "I didn't send").
- UI text is English. Labels use plain words (spec section 11), not code names.

## Evidence on Hand
Drafts made in fake mode from the fixtures in `fixtures/` (see docs/testing.md). No real screenshots, brand assets or logo exist.

## Product Principles
1. Show the evidence next to the claim; unsupported sentences are visible at a glance.
2. The next action is always obvious; blockers say why and how to fix them.
3. Never imply certainty the data does not have (previews are marked approximate).
4. Speed for a repeat user: keyboard first, no modals for routine steps.

## Accessibility & Inclusion
Keyboard operable end to end, visible focus, text contrast at least 4.5:1, status never conveyed by color alone. Names can carry Vietnamese diacritics.

<!-- Inferred, not interviewed: the user was asleep and told the agent to decide and log open choices. Confirm in the morning. -->

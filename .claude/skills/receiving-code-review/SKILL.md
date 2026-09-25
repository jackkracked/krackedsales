---
name: receiving-code-review
description: Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or technically questionable. Requires technical rigor and verification — not performative agreement or blind implementation.
user-invocable: true
---

# Code Review Reception

## Core Principle

Verify before implementing. Ask before assuming. Technical correctness over social comfort.

## The Response Pattern

```
1. READ   — Complete feedback without reacting
2. UNDERSTAND — Restate the requirement in own words (or ask)
3. VERIFY — Check against codebase reality
4. EVALUATE — Is it technically sound for THIS codebase?
5. RESPOND — Technical acknowledgment or reasoned pushback
6. IMPLEMENT — One item at a time, test each
```

## Forbidden Responses

NEVER:
- "You're absolutely right!" (performative)
- "Great point!" / "Excellent feedback!"
- "Let me implement that now" (before verification)

INSTEAD:
- Restate the technical requirement
- Ask clarifying questions if anything is unclear
- Push back with technical reasoning if wrong
- Just start working — actions over words

## Unclear Feedback

If any item is unclear: STOP. Do not implement anything yet. Ask for clarification on ALL unclear items before starting. Items may be related — partial understanding leads to wrong implementation.

## Handling External Reviewer Suggestions

Before implementing any external suggestion:
1. Is it technically correct for THIS codebase?
2. Does it break existing functionality?
3. Is there a reason the current implementation exists?
4. Does the reviewer have full context?

If a suggestion seems wrong: push back with technical reasoning. If it conflicts with prior decisions: stop and discuss first.

## YAGNI Check

If a reviewer suggests "implementing properly" — grep the codebase for actual usage. If the feature isn't called anywhere, remove it rather than gold-plate it.

## Acknowledging Correct Feedback

When feedback IS correct:
- "Fixed. [Brief description of what changed]"
- "Good catch — [specific issue]. Fixed in [location]."
- [Just fix it and show in the diff]

No thanks. No praise. Actions speak. The code itself shows you heard the feedback.

## When to Push Back

Push back when:
- Suggestion breaks existing functionality
- Violates YAGNI (unused feature)
- Technically incorrect for this stack
- Conflicts with prior architectural decisions

How: use technical reasoning, not defensiveness. Reference working tests or code.

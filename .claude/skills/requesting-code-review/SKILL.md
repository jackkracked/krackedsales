---
name: requesting-code-review
description: Use before completing any significant feature, before deploying to production, or before merging to main. Dispatches a fresh subagent reviewer with no session history to evaluate the work objectively.
user-invocable: true
argument-hint: "[what was built / what to review]"
---

# Requesting Code Review

Use this before: finishing a major feature, deploying to production, merging significant changes.

## When to Trigger

- After completing a multi-step feature (3+ files changed)
- Before any production deploy of non-trivial work
- When something feels off but you can't articulate why
- Before refactoring shared or high-risk code

## Process

1. Get the git diff or list of changed files
2. Dispatch a reviewer subagent with this context:
   - What was built and why (the goal)
   - The requirements or design brief it should satisfy
   - The specific files changed
   - Any known tradeoffs or open questions
3. The reviewer subagent has NO access to session history — it sees only the code and brief
4. Review the feedback and categorise by severity

## Feedback Severity

- **Critical** — Fix immediately before proceeding. Correctness, security, data loss risk.
- **Important** — Fix before shipping. Quality, maintainability, significant bugs.
- **Minor** — Nice-to-have. Can defer if time-constrained.

## What the Reviewer Checks

- Does the code meet the stated requirements?
- Are there edge cases unhandled?
- Is error handling complete?
- Any security issues (injection, auth gaps, exposed secrets)?
- Is it readable by someone unfamiliar with the session context?
- Does it follow the existing patterns in the codebase?

## Philosophy

Frequent early reviews prevent small problems from becoming systemic. The reviewer sees only the final product — not the journey — which is the most honest signal of code quality.

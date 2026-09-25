---
name: brainstorming
description: Structured design exploration before implementation. Use when exploring a problem with no clear solution yet, when multiple valid approaches exist, or when the user wants to think through options before committing. Produces a written design doc before any code is written.
user-invocable: true
argument-hint: "[problem or feature to explore]"
---

# Brainstorming

**Hard gate: Do NOT write any code, scaffold anything, or take any implementation action until a design has been presented and the user has approved it.**

This skill is for situations where the right solution isn't obvious yet. Every "simple" project has unexamined assumptions — this is where you surface them.

## Process

1. **Explore context** — Read relevant files, understand the current system
2. **Ask clarifying questions** — One at a time. Prefer multiple-choice. Surface assumptions.
3. **Propose 2-3 approaches** — Each with honest tradeoffs. No single "obviously correct" option.
4. **Present design** — Incrementally, seeking approval after each major section
5. **Self-review the spec** — Check for gaps, ambiguities, unresolved decisions
6. **Get explicit user approval** — Do not proceed without it
7. **Hand off to writing-plans** — The only skill invoked after brainstorming

## Rules

- Always propose alternatives — never present a single path as the only option
- Trade-offs must be honest, not marketing for your preferred approach
- Document the approved design to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
- "Simple projects" are where unexamined assumptions cause the most wasted work

## Terminal State

After user approves the design: invoke `writing-plans` to create the implementation plan. Do not jump directly to code.

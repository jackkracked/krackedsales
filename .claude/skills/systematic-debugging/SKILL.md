---
name: systematic-debugging
description: Structured root-cause debugging framework. Auto-invoked after 2+ failed fix attempts on the same bug. Also use when the user says "debug this" or "why is this broken". Never apply a fix without a confirmed root cause.
user-invocable: true
argument-hint: "[bug description or error]"
---

# Systematic Debugging

**Core rule: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST.**

Applying a fix before confirming root cause is guessing. Guessing compounds problems.

## Phase 1 — Root Cause Investigation

- Read the full error message and stack trace. Do not skim.
- Reproduce the issue consistently before touching any code.
- Review recent changes that could be related.
- In multi-component systems: add diagnostic logging at each boundary to trace exactly where the failure originates.
- Trace data flow backward from the symptom to the source.

## Phase 2 — Pattern Analysis

- Find similar working code in the codebase.
- Read the working implementation completely.
- Compare working vs broken: what is structurally different?
- Identify all dependencies and assumptions each version makes.

## Phase 3 — Hypothesis and Testing (Scientific Method)

- State a specific, falsifiable hypothesis about the root cause.
- Make the smallest possible isolated change to test it.
- Verify the result before moving to implementation.
- If the hypothesis is wrong, form a new one — do not patch blindly.

## Phase 4 — Implementation

- Write a failing test that reproduces the confirmed bug first.
- Implement a single fix that addresses the confirmed root cause.
- Verify the fix passes the test without breaking others.

## Critical Safeguard

If 3+ fix attempts have failed: STOP. Do not apply another patch. Question the architecture. The current approach is likely wrong at a structural level. Escalate to the user with findings before proceeding.

## Red Flags (stop if you catch yourself doing these)

- "Let me try a quick fix..."
- Making multiple changes simultaneously
- Skipping test verification
- "It's probably just..."
- Reverting to a previous attempt without understanding why it failed

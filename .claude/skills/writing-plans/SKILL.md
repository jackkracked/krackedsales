---
name: writing-plans
description: Generates a comprehensive, step-by-step implementation plan before any code is written. Auto-invoked for complex multi-file tasks. Each step is small enough to complete and verify in 2-5 minutes. Plans are written to tasks/todo.md.
user-invocable: true
argument-hint: "[feature or task to plan]"
---

# Writing Plans

Creates implementation plans fine-grained enough that any engineer — even one unfamiliar with the codebase — can execute each step without ambiguity.

## Plan Structure

**Header:**
- Goal: what success looks like
- Architecture: which systems are involved
- Tech stack: languages, frameworks, key libraries

**File Map:**
- Files to create (with paths)
- Files to modify (with reason)
- Files to delete (with reason)

**Task List:**
- Checkbox syntax for progress tracking
- Each task: one action (write test, implement, verify, commit)
- Exact file paths in every step
- Complete code — no placeholders like "add validation here" or "similar to task N"

## Task Granularity

Each step should take 2-5 minutes:
1. Write a failing test
2. Verify it fails for the expected reason
3. Implement the minimal change to make it pass
4. Verify all tests pass
5. Commit

No abstract instructions. Every step contains the actual content an engineer needs to execute it.

## Quality Check Before Finalising

- Does every step have complete, runnable code?
- Are there any "TBD" or placeholder items? (eliminate all of them)
- Do types stay consistent across steps?
- Does the plan cover all the requirements from the design/brief?

## Output Location

Write the plan to `tasks/todo.md`. Check it in before beginning execution.

## Execution Paths

After the plan is written, offer two paths:
1. **Subagent execution** — fresh agent per task, with review between tasks
2. **Inline execution** — execute each step in the current session with checkpoint reviews

The user chooses. Do not default to one without asking.

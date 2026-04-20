# AGENTS.md — tests

## Project test rules (this repository)

- **Runtime:** Python 3.13 locally; CI workflow currently uses Python 3.11 for `schedule_tasks.py` only — align versions if you add a formal test job.
- **Layout:** When pytest (or similar) is added, keep tests under `tests/` with names like `test_schedule_tasks.py` mirroring the module under test.
- **Scenarios:** Frame tests around real scheduling outcomes (week boundaries, heap distribution, empty backlog) rather than abstract single-line unit checks unless the behavior is inherently atomic.
- **Secrets:** Never commit Todoist API keys; use `.env` / CI secrets for anything that hits the network.

<!-- BEGIN GLOBAL TEST RULES (managed by sync-global-agents.sh) -->
# Test Suite Architecture

This project treats tests as production documentation for real user flows.
Each test should answer: **"what happened for a real user or system event?"**

## Naming conventions

### Scenario-first descriptions

Write `describe`/`it` (pytest: test names / docstrings) as production-like stories where the framework allows:

- A weekly cron run distributes undated Todoist tasks without violating the configured week start
- Avoid: returns true when input is valid
- Avoid: calls helper function

## Assertions philosophy

- Prefer assertions on behavior: resulting task dates, counts per day, invariants of the heap distribution.
- Avoid overfitting to implementation details (exact internal call order) unless that order is part of the contract.

## Realism requirements

- Use plausible task titles and real timezone names (`America/Los_Angeles`) when fixtures need them.
- Avoid placeholder strings where realistic values clarify intent.

## Flaky test anti-patterns

- Do not add sleeps or longer timeouts as a first fix for flakes. Control clocks or fixtures deterministically.
<!-- END GLOBAL TEST RULES (managed by sync-global-agents.sh) -->

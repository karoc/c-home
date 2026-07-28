# CLAUDE.md

<!-- Managed by jiling. Project may add content outside markers. -->

<!-- jiling:managed:start -->

## Table of Contents

- Critical Rules
- General Rules

## 1) Critical Rules

### Critical Agent Rules

Treat these as the first rules to apply before project-specific detail:

- Do not bypass CI/CD, deploy, publish, or manual confirmation gates.
- Do not claim deploy, publish, payment, smoke, or workflow success without
  checked evidence.
- Run the repository's required validation for any code, generated-config,
  rule, or runbook change.
- Read the project engineering principles and relevant runbooks before payment,
  security, permission, account, admin-config, release, or cross-system work.
- Use an active plan source of truth for multi-stage, blocked, release,
  payment, or cross-system work.
- Do not expose secrets, provider ids, internal database ids, raw diagnostics,
  tokens, or credentials in public/user-facing surfaces, logs, screenshots,
  commits, plans, or handoff text.
- Lead agents own integration, conflict resolution, final validation, and
  user-facing claims.
- If required validation cannot run, state exactly why, what remains
  unverified, and what is needed to finish.

tags: governance, validation, safety

## 2) General Rules

### Planning Source Of Truth

For multi-stage, cross-system, payment, permission, financial, security,
account, admin-config, release, or long-running work, maintain a repository
planning source of truth before implementation.

Use root `PLAN.md` when the task is the active project thread. Use a focused
docs/runbook/checklist file when the plan belongs to a durable operational
area, and link it from `PLAN.md` if it governs current work. Simple one-shot
fixes do not require `PLAN.md` unless the work becomes staged, blocked,
cross-system, payment/security-sensitive, or spans multiple handoffs.

The active plan should record current status with an absolute date, objective,
scope boundaries, blockers, execution order, stage boundaries, validation and
acceptance evidence, manual gates, durable follow-up decisions, and evidence
links. Agents must read it before editing and update it when scope, blockers,
stage status, validation evidence, or completion criteria change.

Never use chat memory as the only source of truth for staged work, and never
write secrets, API keys, webhook secrets, session tokens, discount codes, raw
credentials, or unmasked diagnostics into plans, logs, screenshots, commits, or
handoff text.

tags: planning, workflow, handoff, governance

### Deviation Protocol

If a user request conflicts with project rules, pause and explicitly call out:
which rule is being violated, why deviation is needed, and the risks and
rollback plan.

tags: governance, escalation

<!-- jiling:managed:end -->

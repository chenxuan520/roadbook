# 2026-08-03 Map Actions CI Failure Postmortem

## Summary

This postmortem covers the failed delivery of the server-side Roadbook map action API and the accompanying `roadbook-map-editor` skill. The change introduced `POST /api/v1/plans/:id/map/actions` for Go and Cloudflare Worker backends, tests for server-side map edits, and a TRAE CLI skill that explains how an agent should create and edit Roadbook plans through HTTP APIs.

The initial push was premature. The reviewer loop had passed for the code shape available at that time, but I did not monitor the GitHub Actions runs after pushing. Two CI workflows failed:

- `CI Backend`
- `CI Cloudflare Worker`

Both failed for the same reason: the new integration test assertions in `backend/scripts/backend_test.sh` used an incorrect `jq` expression. The service response was valid, but the test expression piped into an array and then attempted to index `.content` or `.plan` from that array.

The immediate fix was to add parentheses around each `jq` predicate:

```bash
(.results | length == 4) and (.content.markers | length == 2)
```

and:

```bash
(.plan.content.markers | length == 2) and (.plan.content.connections | length == 1) and (.plan.content.dateNotes["2026-10-01"].notes == "Morning route.")
```

That fixed the direct CI failure. During the same cleanup, reviewer feedback also drove several correctness fixes:

- Go map actions now run under a repository write lock through `Repository.ApplyMapActions`, rather than splitting `FindByID` and `Save` in the HTTP handler.
- `connect_markers` now stores the matched marker's actual `id` type in `startId` and `endId`, avoiding frontend strict-equality reload failures when an action supplies `"101"` for marker id `101`.
- Cloudflare Worker coordinate validation now rejects `null`, `undefined`, empty strings, booleans, arrays, and objects instead of letting JavaScript `Number(...)` coerce invalid values to `0` or another accidental number.
- The skill was simplified back to a pure HTTP API guide. Earlier local helper scripts were removed because they were unnecessary for a skill whose job is to tell an agent which HTTP endpoints exist and how to call them.
- `README.md`, `docs/api.md`, `cloudflare/README.md`, and `AGENTS.md` were updated to document the new endpoint and the operational rule that pushes must be monitored until CI succeeds.

## Impact

The pushed commit `3277291 feat: add server-side roadbook map actions` left the `master` branch with failing CI until a fix commit could be prepared. The runtime service was not deployed from this repository during the incident, but the repository state was still bad: anyone looking at the branch saw red workflows. That undermines confidence in the change and creates avoidable noise for anyone else working in the repository.

The failed workflows were not caused by production traffic, flaky infrastructure, or an upstream API. They were caused by a test bug introduced in the same change. The bug was preventable with better local validation or, at minimum, by watching CI immediately after push.

## Timeline

1. A request came in to support local-agent editing of Roadbook maps without requiring browser UI interaction.
2. I inspected the existing backend and confirmed that plans were stored as whole JSON `content` documents.
3. I added a map action API in Go and Cloudflare Worker.
4. I added tests and docs.
5. I created a skill folder, initially with unnecessary `.mjs` helper scripts.
6. The user correctly pushed back that the skill should explain HTTP endpoints directly.
7. I removed the helper scripts and converted the skill into a pure HTTP API guide.
8. Reviewer found multiple issues, including lost-update risk, mismatched request-shape docs, Worker coordinate coercion, and README gaps.
9. I fixed those issues and requested re-review.
10. Reviewer found two more medium issues: connection endpoint id type mismatch and remaining Worker number coercion.
11. I fixed those and requested another review.
12. Reviewer reported unresolved blocker/high/medium = 0.
13. The user asked me to commit and push.
14. I pulled, committed, and pushed.
15. I did not monitor CI after pushing.
16. The user reported that the pipeline failed.
17. I inspected GitHub Actions and found `CI Backend` and `CI Cloudflare Worker` failures.
18. The failed logs showed the same `jq` precedence error in both workflows.
19. I corrected the `jq` expressions locally.
20. I requested reviewer re-check of the fix.
21. Reviewer confirmed no blocker/high/medium findings on the fix.
22. I added a mandatory push-monitoring rule to `AGENTS.md`.

## Root Cause

The root cause was not a complex backend problem. It was a simple CI assertion mistake:

```bash
jq -e '.results | length == 4 and .content.markers | length == 2'
```

This expression does not mean "check `.results` length and `.content.markers` length on the original object" in the way it was intended. The pipeline operator changes what the right side sees. The failed CI log showed:

```text
jq: error (at <stdin>:1): Cannot index array with string "content"
```

That message was precise. The expression had already moved into `.results`, which is an array, and then attempted to read `.content` from that array.

The correct expression groups each predicate:

```bash
jq -e '(.results | length == 4) and (.content.markers | length == 2)'
```

The same issue existed in the follow-up verification assertion:

```bash
jq -e '.plan.content.markers | length == 2 and .plan.content.connections | length == 1 ...'
```

The fix is:

```bash
jq -e '(.plan.content.markers | length == 2) and (.plan.content.connections | length == 1) and (...)'
```

## Contributing Causes

### 1. I did not monitor CI after push

The most important process failure was not watching GitHub Actions after pushing. In this repository, a push is not done when `git push` exits successfully. It is done when the relevant workflows finish successfully.

The new rule in `AGENTS.md` now states that after any user-approved push, the agent must monitor all triggered GitHub Actions with `gh run list` and `gh run view --log-failed`, fix failures, and continue until all relevant workflows succeed.

### 2. Local environment did not match CI

The local machine did not have `jq`, so the exact shell integration script could not be run locally as-is. I noticed that limitation earlier, but I accepted partial local validation rather than making sure the CI-only `jq` expression itself was correct.

When a test script depends on a tool unavailable locally, the safe response is not to assume the script is fine. At minimum, the expression should be tested in an environment that has the tool, or the logic should be simple enough and reviewed carefully.

### 3. I overbuilt the skill before correcting its scope

The skill initially included `.mjs` helper scripts. That was a design mistake. The user's actual need was for an installable skill that tells an agent how to call existing HTTP APIs. The extra scripts added surface area and distracted from the straightforward contract:

- login
- create plan
- search coordinates
- submit map actions
- verify plan content

The skill has since been corrected to pure HTTP guidance.

### 4. I did not fully simulate the shared CI path

`backend/scripts/backend_test.sh` is shared by both Go backend integration tests and Cloudflare Worker integration tests. A mistake in that script breaks both workflows. That makes it a high-leverage file and demands more care than a one-off local test helper.

### 5. The change had cross-runtime semantics

The API needed to behave consistently across Go and Worker. The reviewer found that Worker number coercion did not match Go behavior. This is exactly the kind of cross-runtime mismatch that can hide behind apparently simple code. The fix now makes Worker reject non-scalar coordinates just like Go.

## What Went Well

The review loop did catch important behavioral issues before the final fix:

- The Go handler initially performed `FindByID` and `Save` separately. This could lose updates under concurrent requests. Moving the operation into `Repository.ApplyMapActions` fixed the Go file backend by keeping read-modify-write under one write lock.
- The skill initially documented a raw JSON action array even though both servers require an object with an `actions` array. That was corrected.
- The Worker initially accepted some invalid coordinate values due to JavaScript coercion. That was corrected.
- `connect_markers` initially saved raw action ids, which could produce a frontend reload mismatch. That was corrected.

The final reviewer pass reported:

```text
unresolved blocker/high/medium = 0
```

That is the correct gate before pushing a non-trivial backend/API change.

## What Went Wrong

The failure after push was avoidable. I treated passing local checks and review as sufficient and did not follow through on the delivery obligation. A successful push only means Git accepted objects. It says nothing about whether the branch is healthy.

The exact CI break was also avoidable. The `jq` expression was small and could have been reasoned about more carefully. The error was not subtle after seeing the logs. It was a simple precedence/pipeline mistake.

The skill detour was also avoidable. The user asked for a skill so an agent could edit maps. That does not imply local helper scripts. A skill is often best as concise operational knowledge. In this case, the operational knowledge is the HTTP API contract.

## Corrective Actions Already Taken

### Code fixes

- Added `Repository.ApplyMapActions` to perform Go file-backend map edits under a single write lock.
- Updated `PlanHandler.ApplyMapActionsHandler` to use the repository-level atomic method.
- Updated Worker map action implementation to queue same-plan updates in the same isolate.
- Updated Worker coordinate validation to reject invalid non-scalar input.
- Updated `connect_markers` to persist matched marker ids rather than raw action ids.
- Fixed `backend/scripts/backend_test.sh` `jq` expressions.

### Test fixes

- Added Go unit tests for action application.
- Added tests for failure atomicity at the action batch level.
- Added tests for marker removal and connection cleanup.
- Added tests for preserving marker id type when action ids are supplied as strings.
- Added integration-script coverage for `POST /api/v1/plans/:id/map/actions`.

### Documentation fixes

- Updated `docs/api.md` with the map action endpoint.
- Updated `README.md` formal API list.
- Updated `cloudflare/README.md`.
- Updated `AGENTS.md` API alignment guidance.
- Added `skills/roadbook-map-editor/SKILL.md` as a pure HTTP API guide.
- Added the mandatory push-monitoring rule to `AGENTS.md`.

## Preventive Rules Going Forward

### Push monitoring is mandatory

After any push:

1. Run `gh run list --limit 10`.
2. Identify every workflow triggered by the pushed commit.
3. Wait for completion.
4. If any fail, run `gh run view <run-id> --log-failed`.
5. Fix the root cause.
6. Commit and push the fix.
7. Repeat until relevant workflows are green.
8. Only then report completion.

### Shared scripts deserve focused validation

If a script is shared by multiple workflows, treat it as production code. For `backend/scripts/backend_test.sh`, a broken assertion breaks both backend and Worker CI. Future edits to shared scripts should include:

- `bash -n`
- local execution when dependencies are available
- focused review of tool-specific syntax such as `jq`
- monitoring of every workflow that consumes the script

### Skills should stay minimal

A skill should contain the minimum operational knowledge needed by an agent. For Roadbook map editing, that is the HTTP API contract. Helper scripts are only justified when direct API calls are too fragile or repetitive. Here they were not justified.

### Cross-runtime contracts must be explicit

Whenever Go and Worker implement the same endpoint, the request shape, validation rules, error shape, and response shape must match. JavaScript coercion is especially risky; validation should be explicit and conservative.

## Current State

The current working tree includes:

- `POST /api/v1/plans/:id/map/actions` in Go backend.
- Matching map actions endpoint in Cloudflare Worker.
- `roadbook-map-editor` skill as pure HTTP API guidance.
- Updated backend integration script.
- Updated docs.
- Added mandatory CI monitoring rule.

The reviewer has confirmed no unresolved blocker/high/medium findings after the most recent code and test-script fixes.

## Final Notes

The central lesson is straightforward: a pushed change is not complete until the automation that protects the branch has succeeded. The actual failure was small, but the process gap was not. The fix is now encoded in `AGENTS.md` so future work does not stop at `git push`.

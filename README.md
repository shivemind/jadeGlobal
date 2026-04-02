# Postman API Catalog Pipeline

This folder contains a repo-ready GitHub Actions design for onboarding and maintaining OpenAPI-backed services in Postman without creating duplicate APIs or collections.

It is intentionally **Spec Hub only**. The sample does not use Postman API Builder commands or API-version publish commands.

## Files

- `.github/workflows/postman-api-catalog.yml`: main pipeline
- `postman-services.json`: per-service source of truth for spec paths, runtime URLs, and previously created Postman IDs
- `ARCHITECTURE.md`: Spec Hub-only sequence, idempotency controls, and incremental-update model

## Action mapping

- `postman-cs/postman-bootstrap-action@v0`: first-class bootstrap step for workspace, spec, and collection creation or refresh
- `postman-cs/postman-repo-sync-action@v0`: syncs repo state, environments, and Bifrost-backed repo linkage after validation
- `postman-cs/postman-insights-onboarding-action@v0`: optional follow-on step once workspace and environments exist
- `postman-cs/postman-api-onboarding-action@v0`: referenced for the same action family, but intentionally not wired into the workflow so the Spec Hub path stays explicit and transparent
- `postman-cs/postman-aws-spec-discovery-action`: recommended as an upstream discovery workflow that writes newly found specs back into the repo before this pipeline runs

## Operating model

1. Keep `postman-services.json` under version control.
2. Store stable `workspace_id`, `spec_id`, and collection IDs after first successful onboarding.
3. Let pull requests run validation against changed services only.
4. Let `main` push runs promote the validated Spec Hub assets through bootstrap, repo sync, and optional Insights onboarding.

## Build outputs

- `reports/<service>-lint.txt`: governance and syntax output from `postman spec lint`
- `reports/<service>-smoke.txt`: console output from smoke runs
- `reports/<service>-smoke.junit.xml`: JUnit report for CI test reporting
- `reports/<service>-smoke.json`: JSON report for downstream processing
- `reports/<service>-contract.txt`: console output from contract runs
- `reports/<service>-contract.junit.xml`: JUnit report for contract verification
- `reports/<service>-contract.json`: JSON report for downstream processing

Contract or smoke test failures return a non-zero exit code from `postman collection run`, so the job fails without any extra failure wrapper.

## Required secrets and variables

- `POSTMAN_API_KEY`
- `POSTMAN_ACCESS_TOKEN`
- `GH_FALLBACK_TOKEN`
- `POSTMAN_WORKSPACE_ADMIN_USER_IDS` as a repo or org variable
- `POSTMAN_ORG_MODE` as an optional repo or org variable

## Why this avoids duplicates

- The manifest carries stable per-service Postman IDs.
- Bootstrap reuses those IDs when present instead of creating fresh assets.
- The workflow processes only changed services, which limits accidental replays.
- Concurrency is serialized per git ref to reduce overlapping writes.

## AWS spec discovery

This workflow references `postman-aws-spec-discovery-action` as the feeder stage, but it is intentionally kept upstream from the Spec Hub sync workflow. The cleanest pattern is:

1. Scheduled discovery workflow runs the AWS action.
2. It commits discovered or refreshed OpenAPI specs into `openapi/`.
3. That commit triggers `postman-api-catalog.yml`.

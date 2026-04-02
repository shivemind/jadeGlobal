# Spec Hub CI/CD Design

## Pipeline sequence

1. Source of truth stays in git as OpenAPI files listed in `postman-services.json`.
2. `postman-bootstrap-action` creates or refreshes the workspace, Spec Hub spec, and baseline, smoke, and contract collections for a single service.
3. `postman spec lint` validates the repo spec against governance rules from the target workspace.
4. `postman collection run` executes smoke and contract suites using the collection IDs returned by bootstrap or already stored in the manifest.
5. `postman-repo-sync-action` syncs the validated service state back to the Postman workspace and publishes the repo linkage through the Bifrost-backed integration path.
6. `postman-insights-onboarding-action` is optional and only runs for services that already have a deployed runtime and should appear in Insights.

## Idempotency model

- `postman-services.json` stores stable Postman IDs after first creation.
- Bootstrap receives those IDs on subsequent runs, so it updates existing Spec Hub and collection assets instead of creating new ones.
- Only services whose `spec_path` changed are selected on pull requests and pushes.
- GitHub Actions concurrency is serialized per ref to reduce overlapping writes against the same repo state.

## Versioning and incremental updates

- The version field in `postman-services.json` gives CI a stable release label source even when the underlying spec filename stays constant.
- Incremental execution happens in the `plan` job, which builds the matrix from changed spec files.
- For broader rollouts, `workflow_dispatch` can target a single `service_key`.

## Why this stays out of API Builder

- Linting uses `postman spec lint`, which is the Spec Hub command.
- The workflow does not call `postman api lint` or `postman api publish`.
- Publishing to the centralized catalog happens through repo-sync and the Bifrost integration path, not API Builder version publishing.

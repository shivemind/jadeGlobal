# Spec Hub CI/CD Design

## Pipeline sequence

1. Source of truth stays in git as OpenAPI files listed in `postman-services.json`.
2. `postman-bootstrap-action` creates or refreshes the workspace, Spec Hub spec, and baseline, smoke, and contract collections for a single service.
3. `postman spec lint` validates the repo spec against governance rules from the target workspace.
4. `postman collection run` executes smoke and contract suites using the collection IDs returned by bootstrap or already stored in the manifest.
5. `postman-repo-sync-action` syncs the validated service state back to the Postman workspace, creates prod/stage environments, and publishes the repo linkage through the Bifrost-backed integration path.
6. **Provision system environment** — the pipeline creates a Production system environment via the Postman API (or reuses the one stored in `postman-services.json` from a prior run).
7. `postman-insights-onboarding-action` onboards services that have `enable_insights: true` into the Postman Insights Service Graph using the provisioned system environment.
8. **Persist IDs** — on `main` pushes, the `persist_ids` job commits the newly created `system_env` UUID back to the manifest and environment files so subsequent runs and Kubernetes deployments can reference it.
9. `validate_dependency_graph` job runs after all services complete, verifying that every declared dependency exists in the manifest and has Insights enabled.

## Self-bootstrapping model

No static UUIDs need to be pre-filled. The pipeline creates everything it needs on first run:

| Asset | Created by | Stored in |
|---|---|---|
| Workspace | `postman-bootstrap-action` | `postman-services.json` (workspace_id) |
| Spec Hub spec | `postman-bootstrap-action` | `postman-services.json` (spec_id) |
| Collections (Baseline, Smoke, Contract) | `postman-bootstrap-action` | `postman-services.json` (*_collection_id) |
| Prod/Stage environments | `postman-repo-sync-action` | Repo sync outputs (environment-uids-json) |
| System environment | `provision_system_env` step via Postman API | `postman-services.json` (system_env), committed by `persist_ids` job |
| Insights onboarding | `postman-insights-onboarding-action` | Action outputs |

On the first successful run, `system_env` in the manifest goes from `""` to a real UUID. All subsequent runs reuse it.

## Idempotency model

- `postman-services.json` stores stable Postman IDs after first creation.
- Bootstrap receives those IDs on subsequent runs, so it updates existing Spec Hub and collection assets instead of creating new ones.
- Only services whose `spec_path` changed are selected on pull requests and pushes.
- GitHub Actions concurrency is serialized per ref to reduce overlapping writes against the same repo state.
- The `persist_ids` job only commits when the system_env value actually changes.

## Versioning and incremental updates

- The version field in `postman-services.json` gives CI a stable release label source even when the underlying spec filename stays constant.
- Incremental execution happens in the `plan` job, which builds the matrix from changed spec files.
- For broader rollouts, `workflow_dispatch` can target a single `service_key`.

## Why this stays out of API Builder

- Linting uses `postman spec lint`, which is the Spec Hub command.
- The workflow does not call `postman api lint` or `postman api publish`.
- Publishing to the centralized catalog happens through repo-sync and the Bifrost integration path, not API Builder version publishing.

## Dependency graph and Insights integration

The dependency graph is defined declaratively in `postman-services.json` at two levels:

### Manifest-level graph

The top-level `dependency_graph.edges` array defines service-to-service relationships:

```json
{
  "dependency_graph": {
    "edges": [
      {
        "from": "payments-api",
        "to": "accounts-api",
        "relationship": "payments-api validates source accounts before processing"
      }
    ]
  }
}
```

### Service-level dependencies

Each service carries a `dependencies` array listing the `service_key` values it calls:

```json
{
  "service_key": "payments-api",
  "dependencies": ["accounts-api"]
}
```

### Insights Service Graph — edge discovery

For edges to appear in the Postman Insights Service Graph at runtime:

1. **The pipeline provisions a shared `system_env`** — created on first run, persisted to the manifest, and reused on all subsequent runs. All services in the graph must share this UUID.
2. **W3C `traceparent` headers are propagated** on every inter-service HTTP call. The collection pre-request scripts auto-generate `traceparent` headers for smoke and contract test runs.
3. **The DaemonSet agent runs with `--repro-mode`** in the `postman-insights-namespace` to capture HTTP headers from live traffic.
4. **`hostNetwork: true`** and **`dnsPolicy: ClusterFirstWithHostNet`** are required on all service pods for the DaemonSet to capture traffic (EKS VPC CNI).
5. **Kubernetes DNS names** must be used for inter-service URLs (never raw IPs).

### Traceparent propagation in collections

All Smoke and Contract collections include:
- A **collection-level pre-request script** that generates a W3C `traceparent` header (`00-<32-hex-trace-id>-<16-hex-span-id>-01`) and stores it in `_traceparent`.
- A **collection-level post-response test** that validates `traceparent` format if the service echoes it.
- Each request includes `traceparent: {{_traceparent}}` in its headers.

This ensures that when collection runs hit live services behind the Insights DaemonSet, the agent correlates traces and draws edges in the Service Graph.

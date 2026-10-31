# Operations and recovery

This document covers audit A03. The release and migration procedure in
[deployment.md](deployment.md) remains authoritative. Use one worker, one web
instance and the same immutable image for this Compose topology. Multiple hosts
need a shared heartbeat store or separate monitored worker identities before
scaling. No database schema or adoption contract changes are needed here.

## Readiness and private diagnostics

`GET /health/live` returns 200 while the listener can serve requests. The existing
tRPC `healthCheck` also remains liveness. `GET /health/process` checks the local
worker heartbeat and progress without querying PostgreSQL. Use this route for
routine Docker and external probes. `GET /health/ready` returns 200 only when
the database probe succeeds and local worker health passes. All three health routes
accept HEAD, reject other methods and send `Cache-Control: no-store`. Readiness
returns only `{"status":"ok"}` or `{"status":"unavailable"}` with 503. Restrict
probe traffic at the proxy; no user or queue details are exposed over HTTP.

The authenticated ingress contract in [auth-proxy.md](auth-proxy.md) applies to
all health routes. Compose healthchecks and the optional monitor send the
configured `WEB_PROXY_SECRET` and a fixed local client identity. The monitor
receives that secret separately from web. Keep its `OPS_WEB_URL` pointed at the
private web listener; do not direct this credential-bearing probe to third-party
URLs. External probes should use the public HTTPS proxy. Health routes do not
bypass proxy authentication.

Database readiness and `operations.mjs inspect` deliberately wake a sleeping
database. Use them for release verification and troubleshooting, not frequent
uptime checks. The dedicated readiness pool has one connection, a 10-second
connection deadline,
a PostgreSQL 1-second statement timeout and a 1.5-second client query deadline.
Concurrent checks share one pending query and results cache for 5 seconds.
This adds at most one database connection per web process or explicit inspect
command.
Include those connections in the host's connection budget. Queue queries have a
fixed timeout and can fail closed on a very large backlog. Review their query
plan and production latency when sizing the host.

Every 30 seconds the worker atomically writes a versioned local heartbeat file,
without querying PostgreSQL. It also writes when beginning work, waiting or retrying.
A clean shutdown removes it after its pending writer finishes.
A crash leaves a timestamp that expires. Missing, malformed and far-future
timestamps fail closed. Compose uses a persistent named volume, writable by the
worker and read-only in web and monitor. Standalone processes must share
`WORKER_HEARTBEAT_PATH`, default `tmp/operations/worker.json`, on a private local
filesystem. Run them as the same service account. Do not share a heartbeat path
between workers. A heartbeat proves a responsive worker event loop. It includes
mode, progress time and the start of a sustained failure. Processing without
progress for `OPS_ACTIVE_MAX_MS` adds `worker_stalled`; repeated failures lasting
that long add `worker_retrying`. Both make process health fail. A waiting worker
remains healthy regardless of how long it has been idle.

Progress time resets at fetch, generation and save stage boundaries, including
checkpoint-save retries. The stall budget applies to a single stage rather than
the combined duration of a healthy multi-stage import.

## Worker wakeups and idle recovery

After committing a website or photo import, web atomically replaces an opaque
UUID in `WORKER_WAKE_PATH`. Repeated submissions for pending jobs also notify the
worker. Notification delivery retries three times, then logs
`import_worker_wakeup_failed` without failing the already committed job.

Compose mounts a separate `worker-wake` volume writable by web and worker. Web
still has read-only access to the heartbeat volume. No new listener or public port
is required. Standalone web and worker processes must use the same service account
and absolute wake path. In development the default is `tmp/worker-wake/request`
under the workspace root, shared even when processes have different working directories.

Deploy web and worker together using the updated Compose file so both attach the
wake volume. Install the matching nginx template to give `/health/process` the
dedicated probe allowance, and point any existing uptime monitors at this route.
The release script already installs both templates from the candidate image.
No database migration is needed for this change.

Avoid starting the new worker alongside an old web release: the old web does not
send local notifications and admitted work can wait for reconciliation. The release
script enters maintenance and stops both services before starting the candidate.
If a staged upgrade is unavoidable, upgrade web and attach its wake volume first,
then upgrade worker. The old worker continues polling during that transition.

The worker checks the local token once per second while waiting. It captures the
token before draining the durable queue so submissions racing with an empty scan
cannot be lost. PostgreSQL is authoritative; the token contains no import or user
data and multiple notifications can safely coalesce. Keep one worker per heartbeat
and wake path in this single-host topology.

Startup always scans the queue. After an empty drain, the worker schedules the
next check for the earliest pending save retry or lease expiry, capped by
`WORKER_RECONCILE_MS`, default 1800000 ms or 30 minutes. An empty idle queue causes
no database activity between those scans. A missed notification can delay a new
job by up to this interval. Normal save retry timing and interrupted-job recovery
remain scheduled from the durable timestamps. Queue claim locks, save leases,
checkpoint safety and shutdown draining remain in force.

Recovery polling still wakes Neon. With a five-minute suspend delay, a 30-minute
scan interval keeps an otherwise idle compute awake for roughly one sixth of the
time. At 0.25 CU this is about 30 CU-hours per 30-day month before user activity,
query runtime and other wakeups. Startup verification and the startup/six-hour media
sweep can add activity; the media sweep queries PostgreSQL when checking stored
objects for recipe references. Some wake windows may overlap. This is a reduction
from continuous compute, not zero background compute use.

Database errors retry after five seconds and remain visible in local worker
health. The six-hour media cleanup remains separate. Frequent checks of
`/health/ready`, `inspect`, or open browser pages polling active imports can still
keep Neon awake. Do not replace the local wakeup with PostgreSQL polling or a
persistent database notification listener without reviewing scale-to-zero behaviour.

On the host, inspect aggregate diagnostics with the runtime credentials:

```sh
docker compose -f deploy/compose.yml exec web node scripts/operations.mjs inspect
```

The JSON contains dependency status, heartbeat age, queue totals and oldest ages.
It never selects input, source URLs, user IDs, generated content or exception
messages. Exit status is nonzero for any operational issue. The following
thresholds apply to explicit database diagnostics and cached worker observations:

| Variable | Default ms | Issue |
| --- | --- | --- |
| `OPS_HEARTBEAT_MAX_MS` | 90000 | `worker_stale` |
| `OPS_QUEUED_MAX_MS` | 300000 | `queue_aged` |
| `OPS_READY_MAX_MS` | 600000 | `ready_aged` |
| `OPS_ACTIVE_MAX_MS` | 300000 | `active_aged` |
| `OPS_SAVE_FAILURE_MAX_MS` | 300000 | `save_failure_aged` |

Database probe failure adds `database_unavailable`. Queue/ready/active ages use
the oldest available durable timestamp. Save failure age uses creation time for
failed rows with save attempts and ready rows that have returned from a save or
started a retry. A first save still holding its lease is excluded. Age is a
conservative upper bound because the schema does not record the first save
failure time. Failed checkpoint saves
stay visible until resolved; this includes exhausted retries. Investigate their
user recovery path instead of deleting records to silence alerts.

The worker collects oldest queued, ready, active and failed-save timestamps in its
scheduling query before a drain, at stage changes and after an empty drain. It
writes those aggregate timestamps into the heartbeat. Routine checks calculate
ages from the timestamps without querying PostgreSQL, so known work can cross an
alert threshold while Neon sleeps. Exhausted checkpoint-save failures stay visible
across idle periods. Stage-observation failures are logged and do not fail the
import; the next drain/reconciliation refreshes the observation.

The monitor raises `queue_aged`, `ready_aged`, `active_aged` and
`save_failure_aged` from these cached observations. Queue issues make explicit
diagnostics fail but do not fail process health or take recipe reads offline.
Explicit readiness queries current database state rather than cached queue ages.

This is sampled queue monitoring. A job committed after the last observation whose
notification never reaches the worker can remain unknown for up to
`WORKER_RECONCILE_MS`, plus scan runtime and monitor delivery time. The original
30-second database monitor could detect it sooner. Reconciliation refreshes the
observation before claiming work, but a quickly recovered incident may finish
between monitor polls. Monitor `import_worker_wakeup_failed` and
`import_queue_observation_failed` logs for these delivery/observation failures.

## Alerts, logs and host acceptance

Compose healthchecks run every 30 seconds, allow 60 seconds for startup and mark
unhealthy after three failures. Docker restart policies restart exited processes;
they do not restart unhealthy containers. Use alerts to investigate a stuck
process before deciding whether to restart it.

The optional monitor checks local worker health and web process health every
30 seconds without opening a database pool. Its local heartbeat checks include
cached queue-age alerts. Current queue aggregates remain available through explicit
`inspect`. Set
`OPS_ALERT_WEBHOOK_URL` to an operator-owned HTTPS receiver and optionally
`OPS_ALERT_TOKEN` to its bearer token, then enable it:

```sh
docker compose -f deploy/compose.yml --profile monitoring up -d
```

The receiver accepts JSON with `event`, UTC `timestamp` and fixed `issues` codes.
Events are `operations_alert` and `operations_recovered`; web failure adds
`web_unavailable`. State changes send immediately; unchanged failures remind
hourly. Successful delivery means HTTP 2xx. Failed delivery retries next poll and
logs `operations_alert_delivery_failed`; redirects are rejected and calls time
out after 5 seconds. A monitor restart can resend an active incident. Local
tests use a loopback HTTP receiver; real receivers require HTTPS. This service
has no configured recipients and has not sent an external alert.

Monitor the monitor from outside this host. A host outage also stops its local
monitor. Configure an external HTTPS `/health/process` probe, plus missing-monitor and
failed-delivery alerts in the chosen host's monitoring service. Review
[host-alerts.yml](../deploy/host-alerts.yml) for concrete Prometheus/node_exporter
disk, memory, CPU and missing-host rules. Set the node_exporter scrape job to
`prep-sheet-host`, restrict access and configure the real Alertmanager receiver.
No exporter, external service or alert destination is provisioned by Compose.
For Loki collectors, [log-alerts.yml](../deploy/log-alerts.yml) provides the web
failure rule. Label web logs `service_name="prep-sheet-web"` and configure the
operator's Alertmanager connection. Verify that the collector parses JSON before
relying on this alert.

All runtime services use Docker's local logging driver with 10 MB files and five
files per container, roughly 50 MB before compression. This is a size limit,
not a day-based retention guarantee. Send structured logs to the host's access
controlled collector if longer retention is required. Set that collector to
14 days initially, then review the actual incident/support requirements.
[Docker documents local log rotation here](https://docs.docker.com/engine/logging/drivers/local/).

The listener generates an `x-request-id` UUID for every request and passes it to
the application. Supplied IDs are replaced. Failed 5xx responses log
`web_request_failed`, UTC timestamp, the request ID, a fixed route category,
HTTP status and elapsed milliseconds.
Interrupted responses log `web_response_interrupted` with the same ID. Neither
event logs paths, query strings, cookies, IP addresses, bodies, secrets or raw
exceptions. Ask a reporter for the response ID and approximate time. Alert in the
host collector on at least five 5xx events per minute for five minutes. Exclude
the fixed `route=health` category if readiness 503s would double count
incidents. Use proxy request totals for a separate >5% 5xx ratio alert over five
minutes with at least 100 requests. Application logs alone have no denominator.

Before public traffic, record the host, image digest, timezone, on-call owner,
configured thresholds and receiver, and complete these acceptance checks:

1. Stop the worker in staging. Confirm process health becomes 503 within 95 seconds,
   liveness stays 200, and an alert reaches the actual receiver. Restart and
   confirm recovery delivery. A clean stop removes the marker immediately.
2. Block staging database connectivity after startup. Confirm bounded explicit
   readiness failure and unchanged liveness. Submit work and confirm sustained
   worker errors become `worker_retrying`, then recover when connectivity returns.
   Confirm queued, ready and exhausted save-retry alerts from the heartbeat, and
   inspect current database diagnostics explicitly. Process
   health is not a claim that the database is currently reachable while idle.
3. Stop the monitor and the whole host in turn. Confirm independent monitoring
   catches both. Test rejected webhook delivery and its retry. Verify the actual
   person or escalation route receives each alert.
4. Exercise resource and error-rate rules, log access and retention. Check
   the TLS proxy's probe behaviour on an unhealthy service. Proxy trust is A02's
   scope. Account for polling/retry delays separately from the 95-second HTTP
   process-health target; monitor notification can take another poll and delivery.
5. Leave the application idle with active-import screens closed for more than
   five minutes. Confirm Neon suspends despite Docker probes and heartbeats.
   Submit a job, verify wakeup and completion, then repeat with the local signal
   deliberately omitted to verify the reconciliation backstop. This last check
   requires a real Neon deployment; disposable PostgreSQL cannot prove suspension.

## Recovery objectives and scheduled backups

The initial operating targets are RPO 1 hour and RTO 60 minutes from declaring a
database incident to accepted service restoration. These are proposed objectives,
not measured production guarantees. An hourly dump alone can miss the RPO by its
runtime and transfer delay; schedule more frequently or use the provider's PITR
with a verified recovery point to meet a strict 60-minute bound. Alert when the
latest completed off-host backup is older than 60 minutes. Record backup duration,
archive checksum, completion time, off-host copy acknowledgement and release
image digest in a private backup catalogue.

`scripts/backup-database.mjs` requires an explicit `BACKUP_SOURCE_DATABASE_URL`;
it never defaults to the application's database. It uses PostgreSQL 18 `pg_dump`
in Docker, makes a custom archive, bounds lock waits to 10 seconds and the command
to five minutes, and publishes the completed file without overwriting an archive.
Failure removes the partial file and its container. Credentials travel through
container environment variables, so Docker administration must be restricted.
Use a dedicated backup credential with the required read access and verified TLS.
Supported URL parameters are `sslmode`, `sslrootcert`, `sslcert`, `sslkey`,
`channel_binding` and `connect_timeout`. Certificate paths refer to files on the
Docker client host and mount read-only into the backup container. Unknown
parameters are rejected instead of silently changing the connection contract.

```sh
# Inject BACKUP_SOURCE_DATABASE_URL through the selected secret manager first.
node scripts/backup-database.mjs --directory /var/backups/prep-sheet
```

The `deploy/systemd` service/timer templates provide an hourly schedule for a
Linux host. Review installation, Node, secret-file and archive paths before
installing them. Add failure notification and off-host transfer/encryption in the
host's normal backup service. Keep seven daily and four weekly successful
encrypted off-host recovery points initially. Retention cleanup and backup-age
alerts belong to that configured backup destination; this script never deletes
previous backups. Local POSIX archives use 0600 and new directories 0700. On
Windows restrict the directory ACL separately. Dumps contain private data.

## Isolated restoration rehearsal

```sh
node scripts/rehearse-recovery.mjs /absolute/path/to/rehearsal.dump
# Only for a reviewed unversioned legacy archive:
node scripts/rehearse-recovery.mjs /absolute/path/to/legacy.dump --adopt
```

The tool has no destination URL option. Each run starts its own PostgreSQL 18
container, random password, loopback random port and tmpfs data directory. It
restores only there, with `pg_restore --exit-on-error --no-owner --no-acl`, then
runs versioned migrations and checks the exact release ledger, PostgreSQL major
and ICU collation/version. Adoption runs only when explicitly requested, against
that disposable destination. Cleanup removes only the generated container.
It never restores or adopts the source, development or production database.
The archive remains untouched.
SIGINT/SIGTERM and ordinary exits also attempt cleanup. After SIGKILL or a Docker
daemon outage, list `docker ps -a --filter label=prep-sheet.disposable=recovery`
and remove only the container identified by that failed rehearsal. The backup
tool uses `prep-sheet.disposable=backup` for its temporary client container.
See PostgreSQL's
[pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html) and
[pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html) contracts.

The CLI prints elapsed time and aggregate user/recipe/import counts. It proves
restorability and migration compatibility, not application acceptance for an
unknown production dataset. Use `pnpm test packages/db/src/recovery.test.ts` for
the synthetic rehearsal with exact row equality across users, sessions, recipes,
checkpoints, billing, AI spend, planner, shopping and migration history, plus an
authenticated recipe read from the built application connected to the restored
copy. It also tests a failed backup preserving the good archive and corrupt
archive cleanup. The wrapper owns the source database; the rehearsal owns its
separate restore container. No provider calls are made.

For an actual production archive, run the isolated rehearsal on a restricted
host, then arrange authorised application acceptance on a separate isolated
restore environment. Verify representative records, sign-in/session behaviour,
recipe reads/PDFs and queue payload compatibility with external provider access
disabled. Record dataset size, achieved recovery point, restore/startup/acceptance
times and the measured RTO. Review role grants separately because `--no-owner
--no-acl` intentionally does not reproduce production permissions.

During a real recovery stop admissions and writers, agree the data-loss cut-off,
restore into a fresh production destination using the host provider's reviewed
procedure, verify migrations/ICU and permissions, run acceptance, then switch
credentials and start the matching web/worker image. Keep the damaged database
and incident evidence under access control. Follow the deployment runbook for
application rollback; never erase migration ledger rows to start an old image.

## Evidence and remaining acceptance

On 15 October 2026, the wrapper-owned synthetic rehearsal on Windows/Docker
Desktop restored one user, recipe and checkpoint in 5.762 seconds including
PostgreSQL startup, migration verification and authenticated application startup
and recipe read. Exact selected rows matched, the bad backup preserved its good
archive, corrupt archive recovery failed safely and the source was unchanged.
The full focused test took 14.31 seconds including negative cases. All disposable
containers, volumes and networks were removed. These tiny-fixture timings do not
establish production recovery performance.

The local release gate passed lint, seven uncached package type tasks, the web
release build and the full 46-file suite with 328 passing tests and seven paid AI
skips. A later four-file focused run passed readiness/privacy, worker shutdown,
HTTP/PDF and recovery checks. The Linux release image built successfully, Compose
configuration validated with and without the monitoring profile, and Prometheus
`promtool` accepted all five host alert rules. Packaged CI also exercises a
disposable Compose deployment, including both healthchecks, shared heartbeat
permissions, worker stop/restart and readiness recovery. This test requires
`PREP_SHEET_RELEASE_IMAGE`; ordinary source runs skip it.

No production backup, host deployment, off-host restore, external alert delivery,
resource monitoring or measured production RPO/RTO has been accepted. Those
require the actual host, backup destination and operator-owned receiver.

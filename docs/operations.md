# Operations and recovery

This document covers audit A03. The release and migration procedure in
[deployment.md](deployment.md) remains authoritative. Use one worker, one web
instance and the same immutable image for this Compose topology. Multiple hosts
need a shared heartbeat store or separate monitored worker identities before
scaling. No database schema or adoption contract changes are needed here.

## Readiness and private diagnostics

`GET /health/live` returns 200 while the listener can serve requests. The existing
tRPC `healthCheck` also remains liveness. `GET /health/ready` returns 200 only when
the database probe succeeds and the worker heartbeat is fresh. Both health routes
accept HEAD, reject other methods and send `Cache-Control: no-store`. Readiness
returns only `{"status":"ok"}` or `{"status":"unavailable"}` with 503. Restrict
probe traffic at the proxy; no user or queue details are exposed over HTTP.

The dedicated readiness pool has one connection, a 1-second connection deadline,
a PostgreSQL 1-second statement timeout and a 1.5-second client query deadline.
Concurrent checks share one pending query and results cache for 5 seconds.
This adds at most one database connection per web process and monitor process.
Include those connections in the host's connection budget. Queue queries have a
fixed timeout and can fail closed on a very large backlog. Review their query
plan and production latency when sizing the host.

Every successful 30-second worker queue check atomically writes a versioned
heartbeat file. A clean shutdown removes it after its pending writer finishes.
A crash leaves a timestamp that expires. Missing, malformed and far-future
timestamps fail closed. Compose uses a persistent named volume, writable by the
worker and read-only in web and monitor. Standalone processes must share
`WORKER_HEARTBEAT_PATH`, default `tmp/operations/worker.json`, on a private local
filesystem. Run them as the same service account. Do not share a heartbeat path
between workers. A heartbeat proves a responsive worker and successful queue
check; aged active/ready work detects processing that has stopped making progress.

On the host, inspect aggregate diagnostics with the runtime credentials:

```sh
docker compose -f deploy/compose.yml exec web node scripts/operations.mjs inspect
```

The JSON contains dependency status, heartbeat age, queue totals and oldest ages.
It never selects input, source URLs, user IDs, generated content or exception
messages. Exit status is nonzero for any operational issue. The following
thresholds are shared by the monitor and probes:

| Variable | Default ms | Issue |
| --- | --- | --- |
| `OPS_HEARTBEAT_MAX_MS` | 90000 | `worker_stale` |
| `OPS_QUEUED_MAX_MS` | 300000 | `queue_aged` |
| `OPS_READY_MAX_MS` | 600000 | `ready_aged` |
| `OPS_ACTIVE_MAX_MS` | 300000 | `active_aged` |
| `OPS_SAVE_FAILURE_MAX_MS` | 300000 | `save_failure_aged` |

Database probe failure adds `database_unavailable`. Queue/ready/active ages use
the oldest available durable timestamp. Save failure age uses creation time for
ready/failed rows with `save_attempts > 0`, a conservative upper bound because
the schema does not record the first save failure time. Failed checkpoint saves
stay visible until resolved; this includes exhausted retries. Investigate their
user recovery path instead of deleting records to silence alerts. Queue issues
alert operators without taking otherwise working recipe reads offline. HTTP
readiness tests dependencies only.

## Alerts, logs and host acceptance

Compose healthchecks run every 30 seconds, allow 60 seconds for startup and mark
unhealthy after three failures. Docker restart policies restart exited processes;
they do not restart unhealthy containers. Use alerts to investigate a stuck
process before deciding whether to restart it.

The optional monitor polls dependencies and web liveness every 30 seconds. Set
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
monitor. Configure an external HTTPS readiness probe, plus missing-monitor and
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

1. Stop the worker in staging. Confirm readiness becomes 503 within 95 seconds,
   liveness stays 200, and an alert reaches the actual receiver. Restart and
   confirm recovery delivery. A clean stop removes the marker immediately.
2. Block staging database connectivity after startup. Confirm bounded readiness
   failure, unchanged liveness, database alert and recovery after connectivity
   returns. Check queued, ready and exhausted save-retry incidents too.
3. Stop the monitor and the whole host in turn. Confirm independent monitoring
   catches both. Test rejected webhook delivery and its retry. Verify the actual
   person or escalation route receives each alert.
4. Exercise resource and error-rate rules, log access and retention. Check
   the TLS proxy's probe behaviour on an unhealthy service. Proxy trust is A02's
   scope. Account for polling/retry delays separately from the 95-second HTTP
   readiness target; monitor notification can take another poll and delivery.

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

No production backup, host deployment, off-host restore, external alert delivery,
resource monitoring or measured production RPO/RTO has been accepted. Those
require the actual host, backup destination and operator-owned receiver.

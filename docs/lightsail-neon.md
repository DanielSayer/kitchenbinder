# Lightsail, Neon and DNS-only Cloudflare

This is a deployment preparation runbook for one Linux Lightsail instance, host
nginx, one Compose web process, one import worker and the optional monitor. Neon
PostgreSQL 18 is external. It does not provision anything. The release and schema
contract remains [deployment.md](deployment.md). Read [auth-proxy.md](auth-proxy.md),
[resource-limits.md](resource-limits.md) and [operations.md](operations.md) too.

## Record the inputs

Replace every uppercase placeholder before running host commands. Record the
release commit and image digest, previous image, Linux version/architecture,
AWS/Neon regions, static IP, public hostname, operator and cover, SSH source CIDRs,
OAuth callback, monitored support mailbox, alert receiver and backup destination.
Select the Neon region near the host and measure database latency before launch.

The initial capacity assumption is a 4 GiB RAM, 2 vCPU x86_64 Linux host. It is an
untested starting budget, not a measured user capacity. Build images off-host for
linux/amd64. Container memory ceilings total 2,496 MiB, leaving about 1.5 GiB for
Linux, Docker, nginx and operating tools. Web has 1,536 MiB for the parent and both
PDF worker threads, worker has 768 MiB, monitor 192 MiB. CPU quotas are 1.5, 0.75
and 0.25 cores. These ceilings sum above the host's two cores, so expect contention
at simultaneous peaks. Do not overlap full old/new stacks within this memory
budget. Avoid image builds and large backup/restore work during serving. Docker
memory reservations are soft hints. Swap is disabled per container by setting its
memory-plus-swap limit equal to memory. Verify cgroup/swap accounting on Linux.

Limits are configurable in [compose.yml](../deploy/compose.yml) and
[lightsail.env.example](../deploy/lightsail.env.example). PDF V8 heap limits do not
cap native memory or RSS. Measure maximum recipe/PDF RSS, Node event-loop delay,
latency, worker progress and OOM recovery before choosing public traffic limits.
One web process means at most two active PDFs, one per account. Do not add replicas
without reviewing aggregate API/PDF admission and the single-worker heartbeat.

## Host and network

Use a maintained Ubuntu LTS Linux image. Install Docker Engine and its Compose v2
plugin from the [official Docker repository](https://docs.docker.com/engine/install/ubuntu/),
nginx, CA certificates, PostgreSQL 18 client tools for administration and Certbot
using its [current installation instructions](https://certbot.eff.org/instructions).
Enable Docker and nginx at boot. Keep security updates and planned reboots under
an identified operator. Review host package upgrades.

Attach a Lightsail static IPv4 address before DNS. In Cloudflare create an A record
for PUBLIC_HOST to that address with proxy status **DNS only**. Publish an AAAA
record only if IPv6 routing, nginx and both firewalls have been accepted. Do not
publish a stale AAAA. Cloudflare supplies DNS; nginx terminates public TLS. Do not
enable real-IP rewriting or trust CF-Connecting-IP/X-Forwarded-For. Turning on the
Cloudflare proxy requires an authenticated/restricted origin and trusted-peer
review under auth-proxy.md before it can carry traffic.

Use the [Lightsail firewall](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html)
to allow TCP 80/443 and TCP 22 only from OPERATOR_IPV4_CIDR and, if used,
OPERATOR_IPV6_CIDR. Review IPv4 and IPv6 rules separately. During private staging,
restrict 443 to acceptance clients; HTTP-01 requires public port 80 for validation.
The HTTP maintenance site serves only ACME challenges. There must be no ingress
rule for 3001, PostgreSQL, Docker API or exporters. Restrict private-network peers
too; public-IP firewall rules alone do not secure private traffic. Outbound needs
DNS, HTTPS for providers/registry/updates/alerts and TCP 5432 to Neon. If Neon IP
allowlisting is available on the selected plan, review the static egress IP there.

Use SSH keys, disable password/root login after verifying a second key-based
session, restrict sudo, keep an out-of-band recovery procedure and remove broad
browser-SSH rules if unused. Docker group membership is root-equivalent. Keep
untrusted users and containers off this host/network. A host firewall must account
for Docker's forwarding rules; do not assume UFW protects published container
ports. The app remains bound to 127.0.0.1:3001 on the host.

## Secrets and immutable images

Install release configuration and scripts under `/opt/prep-sheet`, owned by root.
Use root-only `/etc/prep-sheet` with a 0600 `runtime.env`, based on the example.
Deliver secrets through the selected secret manager or an encrypted operator
channel. Never bake them into images, paste them into shell history, commit them,
or print rendered `docker compose config`/`docker inspect` in shared diagnostics.
Docker administrators can read container environments.

Use separate random secrets for sessions and the proxy. Write the proxy secret
also into root-only `/etc/nginx/private/prep-sheet-proxy-secret.conf`:

```nginx
proxy_set_header X-Prep-Sheet-Proxy-Secret "VALUE_FROM_SECRET_MANAGER";
```

The secret is overwritten on every proxied location. Keep the private include 0600,
its directory 0700 and out of shared backups. nginx's root master reads it before
dropping privileges. Rotate with a maintenance window so web and nginx agree.
Do not use `nginx -T` in shared diagnostics, since it prints the include.

Publish a tested Linux image using an immutable release tag, then record and pin
its registry digest. Registry credentials should be pull-only on the host. These
are future operator actions, not actions performed by this preparation:

```sh
# On the build machine, after the release checks in deployment.md:
docker buildx build --platform linux/amd64 -t REGISTRY/OWNER/prep-sheet:RELEASE_COMMIT --push .
# On the host, with the actual digest in runtime.env:
cd /opt/prep-sheet
sudo docker compose --env-file /etc/prep-sheet/runtime.env -f deploy/compose.yml pull
```

For a private offline transfer, use `docker buildx build --platform linux/amd64
--load` with a unique local tag, `docker save`, transfer the archive and its SHA-256
through an authenticated channel, verify the checksum and `docker load` on the
host. Record the image ID and use that immutable `sha256:IMAGE_ID` as
PREP_SHEET_IMAGE. A loaded archive need not have a registry RepoDigest. Do not reuse
mutable latest or rebuild separately for worker/web. Keep the accepted previous
image locally and enough disk for both images and backups. Never run volume prune.

## Neon roles, verified TLS and budgets

Create a dedicated UTF-8 database on a PostgreSQL 18 Neon branch. Select a direct
endpoint, with no `-pooler` host component, for runtime, migration and backup.
Transaction pooling is not accepted by this release. Neon's
[role model](https://neon.com/docs/manage/roles) gives Console/API-created roles
neon_superuser membership. Create restricted runtime/backup roles with SQL instead
and do not grant them that membership.

Use `sslmode=verify-full` in all three URLs with the actual endpoint hostname.
The locked node-postgres parser preserves chain and hostname checks for that mode
using Node's trusted roots. Do not set NODE_TLS_REJECT_UNAUTHORIZED=0,
sslmode=no-verify, uselibpqcompat or an insecure custom SSL object. If a private CA
is needed, mount its reviewed PEM read-only and use sslrootcert at a path inside
every affected container. For PostgreSQL 18 libpq tools use
`sslmode=verify-full&sslrootcert=system` with a populated CA store, or a CA PEM.
The backup script mounts explicit sslrootcert files into its PostgreSQL container;
do not pass system as a file path to that script. Use an actual trusted root PEM
for BACKUP_SOURCE_DATABASE_URL. Validate the
[certificate/hostname contract](https://neon.com/blog/avoid-mitm-attacks-with-psql-postgres-16)
on the actual service. Never replace the endpoint hostname with its IP.

As Neon database administrator, create separate SQL login roles. This is a template
for an empty dedicated database, not an automatic migration. Replace PREP_DATABASE
with its SQL identifier. Generate passwords in the secret manager and set them
using interactive psql `\password ROLE` to avoid history. Do not run these grants
against a shared database.

```sql
CREATE ROLE prep_sheet_migrate LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE prep_sheet_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE prep_sheet_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
REVOKE ALL ON DATABASE PREP_DATABASE FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE PREP_DATABASE TO prep_sheet_migrate;
GRANT CONNECT ON DATABASE PREP_DATABASE TO prep_sheet_runtime, prep_sheet_backup;
-- Run the remaining commands while connected to PREP_DATABASE.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO prep_sheet_migrate;
GRANT USAGE ON SCHEMA public TO prep_sheet_runtime, prep_sheet_backup;
-- Initial wait budgets, validate under actual contention and imports.
ALTER ROLE prep_sheet_runtime IN DATABASE PREP_DATABASE SET statement_timeout = '15s';
ALTER ROLE prep_sheet_runtime IN DATABASE PREP_DATABASE SET lock_timeout = '3s';
ALTER ROLE prep_sheet_runtime IN DATABASE PREP_DATABASE SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE prep_sheet_runtime IN DATABASE PREP_DATABASE SET transaction_timeout = '60s';
ALTER ROLE prep_sheet_backup IN DATABASE PREP_DATABASE SET statement_timeout = '240s';
ALTER ROLE prep_sheet_backup IN DATABASE PREP_DATABASE SET lock_timeout = '10s';
ALTER ROLE prep_sheet_backup IN DATABASE PREP_DATABASE SET idle_in_transaction_session_timeout = '60s';
```

Set passwords for the three new roles, then reconnect to PREP_DATABASE as
`prep_sheet_migrate`. Before running migrations, apply these default privileges
as that role:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE prep_sheet_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO prep_sheet_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE prep_sheet_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO prep_sheet_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE prep_sheet_migrate IN SCHEMA public
  GRANT SELECT ON TABLES TO prep_sheet_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE prep_sheet_migrate IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO prep_sheet_backup;
```

Neon's administrator is not a PostgreSQL superuser and cannot automatically set
another role's default privileges. Running this block as the migration owner
avoids granting administrator membership to the runtime or backup roles.

The migration role owns every application object it creates and can create/drop
the runner's temporary verification schema and ICU collation. It is not delivered
to web/worker/monitor. The runner applies its own 10-second lock and 60-second
statement budgets. Keep ownership consistent on every release; review legacy
ownership separately before adoption. Neon ICU creation, catalogue permissions,
role grants and restricted runtime startup still need acceptance on a real branch.
Do not weaken verification to work around a provider permission error.

Inject the migration URL only for the one-off migration/verification container,
using root-only `/etc/prep-sheet/migrate.env` containing DATABASE_URL. Use the exact
release image ID/digest as RELEASE_IMAGE:

```sh
sudo docker run --rm --env-file /etc/prep-sheet/migrate.env RELEASE_IMAGE node packages/db/scripts/migrate.mjs
sudo docker run --rm --env-file /etc/prep-sheet/migrate.env RELEASE_IMAGE node packages/db/scripts/migrate.mjs --verify
```

For an empty installation run normal migrations. For legacy databases follow the
stopped-writer backup/adoption procedure in deployment.md. Never use db:push or
replay upgrade SQL independently. After each migration, as `prep_sheet_migrate`, refresh grants
and restrict the ledger, since default privileges also apply to that table:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO prep_sheet_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prep_sheet_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO prep_sheet_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO prep_sheet_backup;
REVOKE ALL ON TABLE public.prep_sheet_migration FROM prep_sheet_runtime;
GRANT SELECT ON TABLE public.prep_sheet_migration TO prep_sheet_runtime;
```

Reconnect with each actual login. SHOW all four runtime timeouts; check
PostgreSQL major 18 and ICU verification. Confirm the client connection is
encrypted and validates the certificate chain and hostname. `pg_stat_ssl`
describes the backend connection and can report no TLS behind Neon's proxy even
when the client has verified TLS. Verify a wrong hostname/untrusted CA fails.
Runtime must perform app DML but not DDL or ledger writes. Backup must read
all records/sequences without writes/DDL. In isolated staging, test lock contention,
statement cancellation, failover/reconnect, idle transaction termination and cold
starts. Runtime has no CREATE or TEMP grant in this template.

Start with DATABASE_POOL_MAX=5. Web's two pools plus worker's pool can use 15
connections. Web readiness and monitor add two one-connection pools, giving a
steady-state upper budget of 17. Web healthchecks use HTTP and worker healthchecks
read the heartbeat, so neither opens another database pool. Startup verification
and manually invoked operations inspect commands use transient connections.
Reserve extra connections for migration, backup and operators; record at least 25
available direct connections for this stack and verify the actual compute's limit.
Do not infer capacity from a plan name. Review changes, overlapping releases or
increased pool size against that budget.

## TLS bootstrap and nginx installation

Remove the distribution default site and inventory other nginx includes to avoid
duplicate default servers. Back up the existing host config. Create
`/var/lib/letsencrypt/.well-known/acme-challenge` and `/etc/nginx/snippets`.
Render nginx-bootstrap.conf.example with PUBLIC_HOST and install it alone under
the http include, for example `/etc/nginx/conf.d/prep-sheet.conf`. It serves only
ACME challenges; other known-host paths return 503 and unknown hosts close.
Run `sudo nginx -t` then reload/start nginx.

Issue the certificate using the actual operator mailbox after DNS points here.
This contacts Let's Encrypt and must be performed by the operator:

```sh
sudo certbot certonly --webroot -w /var/lib/letsencrypt -d PUBLIC_HOST --email OPERATOR_MAILBOX --agree-tos
```

Render nginx.conf.example with PUBLIC_HOST and actual certificate paths
`/etc/letsencrypt/live/PUBLIC_HOST/fullchain.pem` and `privkey.pem`. Render
nginx-proxy.conf with the same PUBLIC_HOST and install it as
`/etc/nginx/snippets/prep-sheet-proxy.conf`. Replace bootstrap with the full config,
keeping only one set of default servers. Install the private secret include first.
Run `sudo nginx -t` before every reload. Do not use a substitution that expands
nginx's `$remote_addr` or `$request_uri` while rendering.

Inspect and enable Certbot's renewal timer. Install an executable root-owned
`/etc/letsencrypt/renewal-hooks/deploy/prep-sheet-nginx`:

```sh
#!/bin/sh
set -eu
/usr/sbin/nginx -t
/bin/systemctl reload nginx
```

Run `sudo certbot renew --dry-run`, inspect the timer and separately run the hook
against the installed cert. Dry-run hook execution depends on Certbot flags/version.
Monitor expiry externally. Keep HTTP-01 port 80 and webroot working for renewals.
No Cloudflare API token or origin-only certificate is required. Unknown SNI fails
before TLS completes; a wrong HTTP Host also fails under valid SNI. HTTPS uses
TLS 1.2/1.3. Initial HSTS is one day without includeSubDomains/preload; increase it
only after HTTPS and recovery are proven.

nginx sends nosniff, DENY framing, strict-origin-when-cross-origin referrers and
camera/microphone/geolocation restrictions. CSP initially restricts base URI,
objects and framing. Full script/style/connect CSP needs built-app/provider testing.
No COOP/COEP policy is imposed on OAuth flows. Review headers with actual browser
login and extension acceptance. Access logs are off and errors critical-only to
avoid routine private URLs/codes. Use app request IDs and private aggregate metrics.
Audit host-wide logging separately for unparsed requests and secret retention.

## Admission and transport

Initial nginx limits are 10 requests/second per IP with immediate burst 40,
50 requests/second across the hostname with burst 100, and at most 12 concurrent
requests per IP and 64 across the hostname. There is no delayed admission queue;
excess receives 429. NAT users share an IP allowance. Health has a separate
2 requests/second per-IP allowance, burst 4, concurrency 4, plus hostname-wide
10 requests/second, burst 20 and concurrency 8. Probe source/host
capacity and attacks that do not complete headers also need host/firewall
monitoring. These admission limits are not a DDoS guarantee.

Bodies match the app byte limits: tRPC prefix 1,572,864, exact Polar webhook
262,144, extension prefix 200,000, all remaining routes 16,384. nginx normalises
paths before location selection; the app independently enforces its own path
budgets. Trailing/encoded variants cannot enlarge the app allowance. Reject
request Content-Encoding except absent/identity. No rewriting/decompression,
webhook signature changes, caching or automatic upstream retries are configured.

Request buffering is off and HTTP/1.1 forwards chunks immediately. Node's bounded
body reader can then enforce the total 15-second upload deadline. nginx's
10-second client-body timeout is only an idle-gap timeout; buffering would permit
indefinite trickling before Node sees it. Header timeout is 10 seconds, keepalive
15 seconds/100 requests, connect 5 seconds, upstream send 15 seconds and upstream
read 45 seconds. Read/send are idle-gap budgets. The 45-second read timeout allows
the initial 15-second DB statement plus 10-second PDF worker deadline and margin.
PostgreSQL transaction/lock budgets bound database waits separately.

## Start, maintain and recover

With accepted schema, role grants and runtime.env, start explicitly:

```sh
cd /opt/prep-sheet
sudo docker compose --env-file /etc/prep-sheet/runtime.env -f deploy/compose.yml config --quiet
sudo docker compose --env-file /etc/prep-sheet/runtime.env -f deploy/compose.yml up -d --wait --wait-timeout 120 web worker
# Only after actual alert delivery is configured and accepted:
sudo docker compose --env-file /etc/prep-sheet/runtime.env -f deploy/compose.yml --profile monitoring up -d monitor
sudo docker compose --env-file /etc/prep-sheet/runtime.env -f deploy/compose.yml ps
sudo nginx -t
sudo systemctl reload nginx
```

Use the same `/opt/prep-sheet` directory or explicit project name each time so the
operations volume stays attached. Never use down -v. Web/monitor mount the shared
heartbeat read-only, worker read-write. The secret reaches web/monitor only.
Health probes retain proxy authentication. Compose health does not prove actual
public TLS or provider acceptance.

For a release, enter maintenance with public admissions disabled, stop web and
drain/stop worker, take the accepted backup, migrate/verify using the new image,
refresh grants, update runtime.env and start both. Check private readiness before
reopening nginx. Use the bootstrap maintenance site or restrict 443 during schema
changes. Preserve web's 40-second stop grace over its 30-second drain, and worker's
200 seconds over its 180-second drain. Do not use kill, restart -t 10 or a shorter
system shutdown stop budget.

For boot/shutdown ordering, review and install
[prep-sheet.service](../deploy/systemd/prep-sheet.service) in `/etc/systemd/system`,
then daemon-reload and enable it along with Docker. It starts web/worker and stops
all Compose services with their own grace before Docker stops. Uncomment its
second ExecStart only after accepting the monitoring receiver, so monitor also
starts after reboot. Test systemctl stop/start and a full reboot. Its
TimeoutStopSec is 300 seconds. Also review Docker's daemon shutdown-timeout and
systemd TimeoutStopSec if containers may be stopped directly by the daemon;
neither may shorten the 200-second worker grace. A larger systemd timeout alone
does not change the daemon's shutdown budget.

The unit explicitly starts services at boot. For a maintenance window spanning
reboot, disable/stop the unit and explicitly re-enable/start it when ready. With
Compose alone, intentionally stopped containers remain stopped under
restart:unless-stopped and require up -d. Before a planned reboot, disable
admissions, stop with normal grace, reboot, check readiness and reopen.
Unhealthy containers do not
restart automatically. Investigate alerts before a supervised restart. Web OOM can
lose per-process API/PDF budgets; database auth counters survive. Rehearse recovery.

Keep rollback within deployment.md's migration-history rules. Never erase ledger
rows or downgrade schema to make an old image start. Keep the previous accepted
image and backup while the new release is accepted.

Use operations.md's backup script/timer with a separate backup URL and CA PEM.
Encrypt/copy archives off-host, verify transfer, configure retention and age/failure
alerts, and restore a representative dump into isolation. Record Neon PITR retention
and a tested recovery point for the selected plan. Initial objectives remain RPO
1 hour/RTO 60 minutes, not measured guarantees. A timer or plan label does not prove
recovery. Connect the monitor to an attended receiver; independently monitor host
loss, monitor silence and certificate expiry outside Lightsail. The local monitor
cannot report total host loss. See deploy/host-alerts.yml and log-alerts.yml.

## Verification and live acceptance

Run `node scripts/validate-deployment.mjs` with Docker and OpenSSL. On Windows it
can use Git's OpenSSL; set OPENSSL_BINARY otherwise. NGINX_TEST_IMAGE and
NODE_TEST_IMAGE may select reviewed parser/fixture images. It creates loopback-only
disposable containers, a one-day self-signed certificate and a fake upstream using
the real body reader, without database/provider calls. It checks Compose parsing,
required secrets/limits, nginx full/bootstrap syntax, HTTPS identity replacement,
unknown hosts/SNI, raw webhook bytes, route/chunked limits, trickle timeout,
connection/rate overload, probe isolation and recovery. It does not accept the
actual Lightsail host, Neon or public certificate setup. Use pnpm test for all
application/database regressions, never direct Vitest. Run the documented SQL
template checks with `pnpm test --config deploy/validation.vitest.config.mjs`.
That wrapper owns the disposable PostgreSQL 18 server; the test creates/drops
an isolated database and random role names, verifies migration ownership, denied
runtime/backup privileges, and actual three-second lock/fifteen-second statement
cancellation. These local checks do not establish Neon permissions or TLS.

Before users, attach an operator-owned record with the exact image and these
results. All remain pending live acceptance:

- Static IP/DNS/IPv6/firewall/SSH rules, unknown-host rejection, public trusted TLS,
  renewals and 3001 unreachable externally.
- Proxy forgery/CSRF checks and independent-client identity/throttling from two
  networks. Keep actual proxy secrets out of probes and diagnostics.
- Neon PostgreSQL 18/ICU, TLS failure cases, role permissions, wait budgets, blocked
  transactions, failover and connection capacity.
- Maximum recipe/PDF/import RSS/CPU/event-loop/latency, overload/OOM recovery,
  health isolation, reboot and full worker drain.
- Off-host/PITR restore with measured RPO/RTO, backup alerts and real external
  incident/recovery delivery including complete host loss.
- Real Google OAuth and attended support. Keep AI/billing disabled until their
  separate provider acceptance. Extension acceptance is independent.

Local verification on 17 October 2026 passed the nginx/Compose validation command,
the one disposable database-role test, and three packaged-image tests covering
HTTP/PDF, proxy authentication/throttle identity and Compose readiness/heartbeat
recovery. The Compose test also inspected Docker's applied CPU, memory/swap and
PID limits. The Linux image build, pnpm check and git diff --check passed. The
systemd template requires parser and shutdown/reboot acceptance on the chosen
Linux host; it was not installed or exercised here. These checks do not establish
real load capacity or any of the live acceptance items above.

No purchase, remote DB mutation, registry publication, real certificate request,
external alert or deployment was performed by this preparation.

## Neon branch validation on 18 October 2026

A temporary child branch in the selected Sydney Neon project passed PostgreSQL
18, UTF-8, certificate-chain and hostname validation, and rejection of an untrusted
CA and mismatched certificate identity. The client TLS socket was encrypted and
authorised; the backend `pg_stat_ssl` value was false behind Neon's proxy.

The restricted migration role applied and verified all five versioned migrations,
including temporary-schema replay and ICU numeric/case/accent comparisons.
Runtime and backup logins passed their intended read/write and denied-DDL checks,
runtime could not write the ledger, and none of the three roles had
`neon_superuser` membership. The configured lock and statement timeouts cancelled
real waits, and a subsequent runtime query succeeded. The connection budget
exceeded the documented minimum.

The original administrator-first default-privilege sequence failed on Neon with
`permission denied to change default privileges`. The sequence above now applies
defaults after reconnecting as the migration owner. The deployment regression
also uses a non-superuser provisioner so this failure cannot be hidden by the
disposable server's superuser.

The parent branch was not migrated. This validation does not accept the future
Lightsail connection, deployed application startup, cold starts, failover,
backups/PITR or operational alert delivery. Repeat the role and release checks
when provisioning the actual deployment database.

# Auth client IP and shared throttling

The production Node listener is the only supported ingress to the built Fetch
application. Do not expose the SSR module through another HTTP adapter without
implementing the same boundary. Better Auth reads only
`X-Prep-Sheet-Client-IP`. The listener creates that header after verification.
It removes `Forwarded`, every `X-Forwarded-*` and `X-Prep-Sheet-*` input,
`X-Real-IP`, `True-Client-IP` and `CF-Connecting-IP`, then writes the verified IP.
Host and request URLs come from `BETTER_AUTH_URL`. The browser's actual Origin
remains intact for Better Auth's CSRF checks.

## Choose the ingress contract

For a Node listener receiving clients directly, omit `WEB_PROXY_SECRET`. It uses
the TCP peer address and ignores all claimed client addresses, including the
internal header. TLS still needs an appropriate deployment arrangement. Do not
use direct mode behind a proxy: all users would share that proxy's counter.

For a reverse proxy, set `WEB_PROXY_SECRET` to a separate randomly generated
base64url secret of 32 to 256 characters. The proxy must overwrite
`X-Prep-Sheet-Proxy-Secret` with that secret and `X-Prep-Sheet-Client-IP` with
one verified address. The listener checks the secret in constant time before
serving any path, including static files. Missing or wrong secrets return 403.
Missing, malformed, duplicate or comma-separated IP headers return 400. There is
no fallback to a shared unidentified-user bucket through the listener.

The secret authenticates the proxy; network access restrictions protect its
transport. Keep Compose's `127.0.0.1:3001:3001` publication. Only the host proxy
should connect to it. Keep untrusted containers off the Compose network and
untrusted users/processes off this host. Docker network peers can reach the
container port even when its host publication is loopback. Do not publish 3001
on `0.0.0.0`, add a second public listener, or place another untrusted service
on this network. For a proxy on another host, use mutually authenticated TLS or
an authenticated private tunnel and firewall ingress to that proxy. Plain HTTP
with this bearer secret across an untrusted network is unsupported.

Compose requires the secret for web startup and does not supply it to workers.
Inject it at runtime from the host's secret manager. Never use
`BETTER_AUTH_SECRET` as the proxy secret, commit the value, log request headers,
or include it in a shell command retained in history.

## Host nginx example

Use [deploy/nginx.conf.example](../deploy/nginx.conf.example) inside nginx's
`http {}` configuration. Set `PUBLIC_HOST`, certificate and key paths to the
actual HTTPS host and match `BETTER_AUTH_URL` to it. Provision TLS and a default
virtual host that rejects unknown hosts through the host's normal procedure.
The example needs no real-IP module for direct public connections.

Generate the proxy secret with a cryptographic secret manager or
`node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"`
in a private terminal. Store the same value as the web container's
`WEB_PROXY_SECRET` and in a private nginx include at
`/etc/nginx/private/prep-sheet-proxy-secret.conf` with administrator-only write
access. Its sole directive is:

```nginx
proxy_set_header X-Prep-Sheet-Proxy-Secret "VALUE_FROM_SECRET_MANAGER";
```

Keep this include out of source control and backups/logs accessible to users.
Run `nginx -t` and reload after setting real values. Do not capture `nginx -T`
in shared diagnostics, since it prints the secret. The example deliberately
overwrites the client identity using `$remote_addr`, never
`$proxy_add_x_forwarded_for`. Incoming forwarding chains have no authority.
nginx's [header replacement rules](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header)
also apply to the private include. Keep all these directives in the same
location so a more specific location cannot silently lose them.

If a CDN or load balancer precedes nginx, first restrict nginx ingress to the
exact proxy addresses and authenticate that upstream where available. Configure
nginx's [real-IP module](https://nginx.org/en/docs/http/ngx_http_realip_module.html)
with `set_real_ip_from` for each actual trusted proxy IP or narrowly scoped
provider CIDR and `real_ip_recursive on`. Use `real_ip_header X-Forwarded-For`
only if every trusted proxy sanitises/appends its immediate peer correctly.
nginx then walks the chain from the right to the last untrusted peer and
overwrites the internal header with the resulting `$remote_addr`. For a
provider-specific single-IP header, use only that provider's documented trusted
ranges and overwrite contract. Never trust `0.0.0.0/0`, `::/0`, all private
networks or a guessed hop count. Record the actual topology and test it before
traffic. If those exact proxy addresses are unknown, this multi-proxy deployment
is not configured yet. The app itself never interprets a forwarding chain.

## Throttling across replicas and restarts

Production auth uses Better Auth 1.7.1's atomic `customStorage.consume` API with
PostgreSQL, using the existing auth pool. Apply migration
`0004_auth_rate_limit.sql` with the versioned migration runner before starting
the release. Legacy adoption includes the equivalent idempotent table upgrade.
The runtime role needs SELECT/INSERT/UPDATE/DELETE on `auth_rate_limit`.

All web replicas must use the same database and `BETTER_AUTH_SECRET`. Counters
are keyed by HMAC of Better Auth's normalised IP and endpoint path, with a
domain separator. No plaintext IP/path is retained in this table. IPv4-mapped
IPv6 shares its IPv4 counter; IPv6 shares a /64 counter. NAT users share an IP
allowance. The built-in defaults remain 100 requests per path per 10 seconds,
with three per 10 seconds for sign-in/sign-up/account credential changes and
three per 60 seconds for the configured recovery paths. Server-internal
`auth.api` calls bypass HTTP throttling as documented by
[Better Auth](https://better-auth.com/docs/concepts/rate-limit).

A single atomic upsert checks and increments the counter, capped at max + 1.
Each accepted request extends the window from database time; a denied request
does not extend it. Concurrent replicas cannot spend the same remaining slot.
Restarting/replacing web processes or proxies retains counters in PostgreSQL.
Changing the auth secret, clearing the table, losing database writes on failover
or restoring a backup can reset counters. Keep secrets consistent during rolling
replacement and treat database recovery as an operational event. The release
runbook otherwise uses maintenance downtime for schema changes.

Auth fails closed if the shared store fails or the two-second counter statement
timeout expires. It emits `auth_rate_limit_unavailable` without database/IP/key
details, and the request fails rather than falling back to process memory.
Better Auth returns 429 with `X-Retry-After` for exhausted allowances.
Each HTTP auth attempt also removes at most ten expired buckets in a separate,
bounded transaction using `SKIP LOCKED`. Cleanup failure emits
`auth_rate_limit_cleanup_failed` without reversing a throttle decision. Idle
expired rows remain until later auth traffic. Monitor table size and these
events. Edge request/connection limits remain necessary for general resource
protection; A01 owns those controls.

## Acceptance on the chosen host

Automated tests exercise real HTTP header sanitisation, Better Auth handlers,
concurrent independent database pools, IPv6 grouping and database expiry. They
do not prove the chosen host firewall, CDN ranges, TLS or nginx deployment.
Before opening traffic, record the release commit/image and perform these checks:

1. Confirm 3001 is unreachable from an external machine. On the proxy host,
   requests to 3001 without the secret or with a wrong secret must return 403.
2. Through public HTTPS, send arbitrary `Forwarded`, `X-Forwarded-*`,
   `X-Real-IP` and both internal headers. They must not change the OAuth callback
   origin, stored session IP or throttle identity. Do not expose the real secret
   while testing. An unexpected browser Origin must still fail CSRF checks.
3. Use two actual client networks. Exhaust the three-attempt sign-in allowance
   from one network; the other must retain its own allowance. For a real proxy
   chain, verify that untrusted leftmost addresses do not change this result.
4. Alternate requests across web replicas, then restart one during the active
   window. The aggregate allowance must remain three, not three per replica.
   Verify the response's retry delay and successful recovery after expiry.
5. Rehearse a shared-store outage privately. Auth must fail closed, liveness
   should remain reachable, and the operational alert must reach its owner.

The proxy host/domain, any upstream trusted proxy addresses, runtime secret
delivery and two test client networks are deployment inputs still needed for
this acceptance. No live OAuth exchange or deployed proxy bypass is claimed.

Local verification on 15 October 2026 also ran `nginx -t` against the example
with placeholder values replaced by an isolated test host, a temporary
self-signed certificate and a test-only secret. It passed using official
`nginx:stable-alpine` image digest
`sha256:ed84151ed2d47ef93c0939eb9b9754c6990db6092cd2081e11988a47a83d47ea`.
This checks nginx syntax, not deployed TLS or upstream-header behaviour.

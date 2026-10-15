# HTTP and PDF resource limits

Audit A01 is enforced in the built Fetch entry and the Node listener. These
defaults apply to a single web process. Deployment acceptance must verify the
actual TLS proxy and host against the same budgets before public traffic.

## Request bodies and batches

| Route | Maximum body bytes |
| --- | ---: |
| `/api/trpc/*` | 1,572,864, or 1.5 MiB |
| `/api/polar/webhooks` | 262,144, or 256 KiB |
| `/api/extensions/*` | 200,000 |
| Auth and all other routes | 16,384, or 16 KiB |

The listener rejects an excessive declared `Content-Length` before dispatch.
The Fetch entry counts actual streamed bytes before any application parser or
authentication handler runs, including when a length is absent or misleading.
It returns 413 on overflow and 408 if the complete body has not arrived within
15 seconds. It cancels reading on rejection. The existing extension handlers
retain their smaller action-specific limits. These are byte budgets, so JSON
escaping and multi-byte characters count towards the total.

The listener sends a rejection immediately, discards further upload bytes in
constant memory for at most one second, then closes the connection. This short
drain lets ordinary clients receive the status without an early TCP reset.
Discarded bytes never reach an application parser or signature verifier.

Bounded buffering forwards the original bytes and signature headers to Polar.
There is no JSON decode/re-encode before webhook signature verification.
The tRPC budget accommodates a single full recipe with 100 ingredient and
100 method lines of 2,000 characters, including ordinary UTF-8 multilingual
text. A batch shares one body budget. Exceptionally escaped JSON or several
maximum-size recipes may need separate requests or smaller content.

The tRPC adapter accepts at most five operations per batch. The web client
splits batches at five operations and limits query URLs to 8,000 characters.
Each authenticated account can submit 120 tRPC operations per minute per web
process. A batch of five costs five operations. Rejection returns tRPC 429
with `Retry-After` seconds and private, no-store caching. Public liveness stays
available after account throttling. Existing durable import and support quotas
continue to apply independently.

## PDF exports

Session validation and account/group access checks still precede rendering.
Each account has six export attempts per minute, including inaccessible recipes
and attempts rejected during saturation. At most one export per account and
two exports across the process can be active. Admission reserves a slot before
the recipe lookup, and there is no waiting queue. Excess account attempts return
429. Saturation returns 503. Both responses include `Retry-After` seconds.

Each admitted render runs in a fresh Node worker with a 10-second deadline,
128 MiB old-generation and 16 MiB young-generation V8 heap limits. Worker heap
limits do not cap total resident memory or native allocations. Outputs larger
than 10 MiB are rejected. The deadline includes worker startup and rendering,
and returns 504 after worker termination. Client disconnects also terminate the
worker. A slot is released only after termination completes. Worker errors
return 503 and release the slot. All PDF responses use `private, no-store`.

The worker keeps synchronous layout off the web event loop. The parent actually
terminates the worker on expiry; it does not merely abandon an awaited render.
The render deadline does not cancel a preceding database lookup. Bound database
connection/query/lock waits operationally; a slow lookup occupies one of the
two slots until it returns. Listener request/header timeouts are transport
controls and do not cancel arbitrary database or CPU work.

Vite emits `dist/server/pdf-worker.js` with embedded Nunito fonts and branding,
and retains the external React PDF dependency tree. Deploy the complete release
artifact and locked runtime installation as described in
[PDF production packaging](pdf-production.md). In development, the Vite plugin
builds the same worker on first module load. Restart the development server
after changing the PDF template or worker.

Account counters are bounded in-memory fixed windows with at most 10,000 tracked
accounts per limiter. New accounts are rejected conservatively if that table is
full of unexpired entries. Counters reset on process restart and multiply across
replicas. The global PDF limit also applies per process. Use edge admission or a
shared limiter before scaling replicas if aggregate budgets must stay fixed.

## Proxy and host acceptance

Configure the eventual proxy to enforce route body budgets no larger than the
table above, including chunked bodies. Reject unsupported request compression
or count decompressed bytes wherever decompression occurs. The application
does not decompress request bodies. Preserve webhook payload bytes and
signature headers exactly. Check trailing-slash and encoded-path routing as
well as the ordinary route names when applying proxy rules.

Set a total request-body read deadline of 15 seconds or less and a bounded
header-read deadline. A timeout between successive bytes alone permits an
indefinite trickle. Configure a PDF upstream response timeout greater than the
10-second worker deadline plus the chosen database lookup budget, so the
application can return its controlled overload/deadline response. Do not retry
PDF requests automatically at the proxy. Keep auth/payment mutation retries
explicit and preserve webhook provider redelivery semantics.

Set finite connection/request concurrency and queue lengths for the host's
memory budget. Account throttling happens after authentication and cannot
protect session lookups or anonymous traffic. Apply anonymous request rates
and admission at the edge, with the trusted client-IP contract from A02.
Allow health checks through independently. Cap PDF upstream concurrency across
replicas, return overload promptly and honour `Retry-After` in clients.

Before public launch, record the proxy configuration and verify declared and
chunked overflow, slow bodies, excessive batches, independent account budgets,
parallel PDF overload and health during maximum-size recipe exports. Watch
resident memory, event-loop delay and response latency under representative
load. Set host/container memory and CPU limits with headroom for the web process
and both workers. Unit regressions and packaged smoke checks do not establish
that a production proxy has these settings or that a particular host can sustain
the chosen traffic level.

## Regression checks

Run `pnpm test`. The wrapper provisions and removes disposable PostgreSQL.
Focused tests cover streamed byte counting/cancellation, slow-body rejection,
unaltered raw webhook bytes, weighted account budgets, worker saturation,
client abort, renderer failure and recovery. A synchronous CPU fixture cannot
write its completion marker after the deadline, proving termination rather
than a discarded promise. Health responds while those workers run.

The production-server regression exercises the built Node listener and direct
Fetch entry, excessive batches, oversized chunked requests, authenticated
exports, font embedding, account isolation, PDF/account throttling and continued
health. CI reruns that regression inside the Linux release image. No real OAuth,
AI or payment submission is needed for these tests.

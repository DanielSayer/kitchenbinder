# Production readiness after A01 to A05

The five production-audit implementations are consolidated in this release.
Passing repository checks permits merging the implementation. Public launch
still requires the environment-specific acceptance below. No live deployment,
OAuth exchange, paid AI import, payment or external support/alert message was
performed during integration.

## Combined contracts

- The Node listener authenticates proxy traffic before serving static, API or
  health routes. Internal healthchecks and monitoring use the same proxy secret.
  Client identity, generated request IDs, body admission and PDF worker limits
  are preserved together.
- Both runtime entry points validate provider choices and support configuration
  before database access. Test fixtures use either the tightly scoped disposable
  topology or synthetic HTTPS provider IDs without making provider calls.
- Apply the complete versioned migration chain through
  `0004_auth_rate_limit.sql`. Auth rate limits use PostgreSQL and survive process
  replacement. General API/PDF counters remain per process; replicas require
  aggregate edge/shared admission and separate worker monitoring identities.
- The packaged CI gate exercises proxy/throttling, listener/PDF, migrations,
  worker drain and Compose healthchecks together. Recovery rehearsals restore
  only to a newly created disposable PostgreSQL 18 instance.

## Pending public-launch acceptance

| Area | Required evidence or configuration | Procedure |
| --- | --- | --- |
| Host and ingress | Chosen runtime, HTTPS hostname, restricted origin access, secret delivery, forged-header rejection, independent client limits, CPU/memory and aggregate resource limits under representative load | [Auth proxy](auth-proxy.md), [resource limits](resource-limits.md) |
| Database | PostgreSQL 18 with ICU, verified TLS, migration/runtime/backup permissions, connection budget, applied and verified candidate migrations | [Deployment](deployment.md) |
| Recovery and alerts | Off-host encrypted backup/PITR destination and retention, named escalation owner, tested alert receiver, worker/database/host failure drills, isolated production-sized restore and measured RPO/RTO | [Operations](operations.md) |
| OAuth | Actual callback registrations and credentials, controlled accounts, real login/logout/linking/account-switching on the HTTPS origin | [Provider acceptance](provider-acceptance.md) |
| AI, if enabled | Approved project/model and spend controls, permission for paid acceptance imports, output and credit-accounting verification | [Provider acceptance](provider-acceptance.md) |
| Billing, if enabled | Separate sandbox configuration and authorised lifecycle checks, then production product/price/trial/tax/webhook review | [Provider acceptance](provider-acceptance.md) |
| Support | Actual monitored `SUPPORT_EMAIL`, responsible `SUPPORT_OPERATOR` and cover, queue review/escalation/retention decisions, verified mailbox receipt/reply and deployed signed-out/signed-in contact | [Account support](account-support.md) |

Support mailbox and operator placeholders deliberately remain blank until the
owner supplies them. Production startup refuses missing values. AI and billing
can remain explicitly disabled while the private staging sign-in and operational
checks are completed.

The separate P2 audit work remains outside these PRs: expired recipe cleanup and
retention policy, billing lock contention, dependency-advisory remediation and
remaining historical setup documentation. Production browser-extension identity,
installed Chrome/Edge acceptance and store release also remain separate if the
extension is included in launch.

# Production readiness after A01 to A05

The five production-audit implementations are consolidated in this release.
Passing repository checks permits merging the implementation. Public launch
still requires the environment-specific acceptance below. No live deployment,
OAuth exchange, paid AI import, payment or external support/alert message was
performed during integration.

The selected target is one Amazon Lightsail Linux instance with the existing
Docker Compose web, import worker and monitoring topology, Neon PostgreSQL 18,
and Cloudflare domain/DNS. Preparation does not provision or accept that target.
Initial private staging is Google only with `AI_ENABLED=false` and
`BILLING_MODE=disabled`, leaving Discord, OpenAI and Polar credentials/product
IDs unset. The actual host, HTTPS origin, DNS and provider configuration remain
pending inputs.

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
| Host and ingress | Actual Lightsail Linux capacity, HTTPS hostname and Cloudflare DNS/ingress arrangement, restricted origin access, secret delivery, forged-header rejection, independent client limits, CPU/memory and aggregate resource limits under representative load | [Auth proxy](auth-proxy.md), [resource limits](resource-limits.md) |
| Database | Neon PostgreSQL 18/ICU and collation verification, trusted certificate/hostname TLS validation, direct migration/verification endpoint, separate migration/runtime roles and backup permissions, connection and query wait budgets, applied and verified candidate migrations before startup | [Deployment](deployment.md) |
| Recovery and alerts | Off-host encrypted backup/PITR destination and retention, named escalation owner, tested alert receiver, worker/database/host failure drills, isolated production-sized restore and measured RPO/RTO | [Operations](operations.md) |
| OAuth | Actual callback registrations and credentials, controlled accounts, real login/logout/linking/account-switching on the HTTPS origin | [Provider acceptance](provider-acceptance.md) |
| AI, if enabled | Approved project/model and spend controls, permission for paid acceptance imports, output and credit-accounting verification | [Provider acceptance](provider-acceptance.md) |
| Billing, if enabled | Separate sandbox configuration and authorised lifecycle checks, then production product/price/trial/tax/webhook review | [Provider acceptance](provider-acceptance.md) |
| Support | Actual monitored `SUPPORT_EMAIL`, responsible `SUPPORT_OPERATOR` and cover, queue review/escalation/retention decisions, verified mailbox receipt/reply and deployed signed-out/signed-in contact | [Account support](account-support.md) |

Support mailbox and operator placeholders deliberately remain blank until the
owner supplies them. Production startup refuses missing values. AI and billing
remain explicitly disabled while the private staging sign-in and operational
checks are completed. Migrate and verify separately, then start web and worker
from the same immutable image. The default release procedure uses maintenance
downtime; mixed releases need an explicit compatibility review.

The separate P2 audit work remains outside these PRs: expired recipe cleanup and
retention policy, billing lock contention and dependency-advisory remediation.
Active setup documentation now directs operators to versioned migrations;
dated verification notes remain historical evidence.

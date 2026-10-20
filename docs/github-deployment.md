# GitHub build and deployment

Every push to `master`, including a merged pull request, runs release checks,
publishes the tested image and automatically deploys it after the checks pass.
Pull requests run checks only. The required `release-checks` job remains the merge
gate; production credentials are available only to the separate deployment job.

For a manual rerun, open **Actions → Deploy production → Run workflow**, select
`master`, and run. Select **dry_run** to check image publication, deployment access
and server configuration without stopping services or issuing database commands.
The manual workflow calls the same pipeline rather than maintaining another copy
of the build or deployment steps. Manually running **Release checks** checks the
selected branch by default; its optional **deploy** input is restricted to master,
and its **dry_run** input defaults to true.

Feature branches cannot deploy. Before obtaining deployment credentials, the
deployment job checks that its commit is still the current `master` head. It
reports a skipped release when a newer commit has superseded it. This avoids an
older, slower build replacing a newer release. A commit already deploying is
allowed to finish; subsequent eligible deployments share the same host lock and
GitHub concurrency group. Intermediate queued commits may be superseded.

The deployment workflow reuses all release checks, including the tests against
the Linux image. It publishes that same image to `ghcr.io/danielsayer/kitchenbinder`,
then passes its digest and full commit to Lightsail. The server verifies the
image's revision label. Web, worker and migrations use that digest. Development
extension ZIPs are checked separately and are not store releases.

During the repository rename, the publisher also pushes the exact same image to
`ghcr.io/danielsayer/prep-sheet` and verifies both registry digests match. This is
a compatibility alias for installed host helpers, not a separate build. New host
helpers pull the Kitchenbinder package. Keep the alias until every installed
helper has been updated and verified. Keep existing old image versions available
for rollback.

The canonical repository is
[`DanielSayer/kitchenbinder`](https://github.com/DanielSayer/kitchenbinder), with
[`kitchenbinder.app`](https://kitchenbinder.app) as its About website. Follow the
[repository and package cutover](kitchenbinder-rebrand.md#repository-and-package-cutover)
procedure when updating these names on an existing installation.

## One-time access configuration

The `production` GitHub environment allows only the `master` branch. It contains:

| Setting | Purpose |
| --- | --- |
| Secret `LIGHTSAIL_SSH_KEY` | Dedicated forced-command SSH identity |
| Variable `DEPLOY_HOST` | Lightsail public IP |
| Variable `DEPLOY_KNOWN_HOSTS` | Independently verified server host keys |
| Variable `LIGHTSAIL_INSTANCE` | Existing Lightsail instance name |
| Variable `DEPLOY_AWS_ROLE` | Short-lived OIDC deployment role ARN |

The AWS account needs an OIDC provider for
`https://token.actions.githubusercontent.com` with audience `sts.amazonaws.com`.
The account's organisation policy can restrict managing that provider. Upgrading
the AWS billing plan and activating advanced features are separate steps. A paid
upgrade alone does not remove the simplified Projects experience's IAM
restrictions. Advanced activation requires management-email verification and
explicit confirmation in AWS Settings; it permanently removes project spend
limits. After activation, review the organisation policies and configure the
provider with the administrator access available for this account. The
versioned [trust policy](../deploy/github-oidc-trust.json) uses this repository's
verified immutable subject prefix and the production environment. The
[permission policy](../deploy/github-firewall-policy.json) grants only open/close
firewall operations on the existing instance. These operations can modify its
public ports; AWS does not constrain this role specifically to TCP 22. The
workflow requests only TCP 22 from its current IPv4 `/32`, then removes that
source in an always-run cleanup step. Existing operator sources are retained.
An abruptly terminated runner can leave its narrow rule behind; inspect SSH
sources after a cancelled or interrupted deployment and remove the stale `/32`.
No AWS access keys are stored in GitHub.

The host firewall must also accept IPv4 TCP 22 so the runner admitted by Lightsail
can reach SSH. This host uses UFW with an IPv4 SSH allow rule; Lightsail provides
the public source-address restriction. Keep Lightsail TCP 22 restricted to the
operator address and the temporary runner `/32`, with no IPv6 SSH rule. Retaining
only an operator-specific UFW rule would block GitHub even after the workflow
opens its Lightsail rule. SSH still requires the dedicated restricted key.

Install `deploy/release.sh` root-owned, mode 0755, as
`/usr/local/sbin/prep-sheet-release`. Install `deploy/ssh-entry.sh` the same way as
`/usr/local/bin/prep-sheet-ssh-entry`. Update these installed files when changing
the helpers; application image deployment does not overwrite the trusted host
helper. The `prepsheet-deploy` account has this root-owned authorised-key entry:

```text
restrict,command="/usr/local/bin/prep-sheet-ssh-entry" ssh-ed25519 PUBLIC_KEY
```

Its sudoers rule permits only `/usr/local/sbin/prep-sheet-release *`. Both helpers
validate the command, image digest, revision and actor before acting. Arbitrary
SSH commands, forwarding and interactive sessions are refused. The registry
password is the deployment job's short-lived read-only GitHub token, sent on SSH
stdin and stored in a private temporary Docker configuration that is removed on
exit. The application, database and provider secrets stay on Lightsail.

After verifying the live nginx configuration is serving the healthy application,
save a root-owned copy as `/etc/prep-sheet/nginx-serving.conf`. The release helper
requires this accepted configuration separately from `nginx-maintenance.conf`.
Update it when accepting a host nginx configuration change. A forward repair
uses it to reopen traffic even when the preceding release left the active nginx
file in maintenance mode.

## Release behaviour

The helper uses `/opt/prep-sheet/deploy/compose.yml`, the existing `deploy` Compose
project and both `/etc/prep-sheet/runtime.env` and `capacity.env`. The capacity
file is required so the 1 GB host keeps its existing smaller limits. It requires
the existing migration, backup and maintenance configuration too. Builds run on
GitHub, outside the serving host.

After checking the candidate image and Compose configuration, a real deployment:

1. Records the previous image, runtime configuration, Compose file and accepted serving nginx file
   in a private directory under `/etc/prep-sheet/releases`.
2. Enables the existing nginx maintenance configuration and drains both services
   with their configured shutdown grace periods.
3. Creates a PostgreSQL 18 custom-format backup under `/var/backups/prep-sheet`,
   checks that its archive catalogue can be read, and records its checksum.
   This local release backup does not replace off-host recovery or restore tests.
4. Runs migration and verification using the candidate image and separate
   migration credential, then refreshes the restricted runtime/backup grants.
5. Pins the runtime image digest, installs the candidate Compose file, starts web
   and worker, and waits for both healthchecks.
6. Restores nginx traffic and checks public HTTPS readiness before recording
   completion. No paid AI or billing calls are made by deployment checks.

GitHub serialises deployments and never cancels an active deployment to start
another. A host lock also refuses overlapping release commands. Expect maintenance
downtime while the backup, migration and startup run.

On failure after maintenance begins, the helper verifies the previous image
against the current database. If compatible, it restores the saved configuration
and starts that image. If incompatible, maintenance stays enabled for an operator
to deploy a compatible forward repair. It never restores a database, removes
migration history or runs destructive schema downgrades automatically.

The local failure tests use fake Docker, nginx and service commands. Run them in
the root Linux fixture used by CI:

```sh
docker run --rm -v "$PWD:/workspace:ro" -w /workspace python:3.12-slim python3 deploy/test_release.py
```

They cover dry-run isolation, wrong-commit rejection, backup/migration/startup
failure, migration-incompatible recovery, forward repair from maintenance, capacity overrides and successful
completion. A hosted dry run separately checks actual OIDC, firewall, SSH and
private image-pull permissions. Only a real deployment exercises backup,
production migration and recovery against the serving installation.

# GitHub build and deployment

Open **Actions → Deploy production → Run workflow**, select `master`, and run.
Select **dry_run** to check image publication, deployment access and server
configuration without stopping services or issuing database commands.
Feature branches cannot deploy. Pushes and pull requests continue to run release
checks automatically; a push does not automatically deploy production.

The deployment workflow reuses all release checks, including the tests against
the Linux image. It publishes that same image to `ghcr.io/danielsayer/prep-sheet`,
then passes its digest and full commit to Lightsail. The server verifies the
image's revision label. Web, worker and migrations use that digest. Development
extension ZIPs are checked separately and are not store releases.

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
The account's organisation policy can restrict managing that provider. The
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

## Release behaviour

The helper uses `/opt/prep-sheet/deploy/compose.yml`, the existing `deploy` Compose
project and both `/etc/prep-sheet/runtime.env` and `capacity.env`. The capacity
file is required so the 1 GB host keeps its existing smaller limits. It requires
the existing migration, backup and maintenance configuration too. Builds run on
GitHub, outside the serving host.

After checking the candidate image and Compose configuration, a real deployment:

1. Records the previous image, runtime configuration, Compose file and nginx file
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
failure, migration-incompatible recovery, capacity overrides and successful
completion. A hosted dry run separately checks actual OIDC, firewall, SSH and
private image-pull permissions. Only a real deployment exercises backup,
production migration and recovery against the serving installation.

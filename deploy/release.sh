#!/bin/bash
# Installed root-owned as /usr/local/sbin/prep-sheet-release.
set -Eeuo pipefail
umask 077

mode=${1:-}
digest=${2:-}
revision=${3:-}
actor=${4:-}
[[ $# == 4 && $EUID == 0 && $mode =~ ^(check|deploy)$ && $digest =~ ^sha256:[a-f0-9]{64}$ && $revision =~ ^[a-f0-9]{40}$ && $actor =~ ^[a-zA-Z0-9-]+$ ]] || exit 64

app=${DEPLOY_APP_ROOT:-/opt/prep-sheet}
config=${DEPLOY_CONFIG_ROOT:-/etc/prep-sheet}
backups=${DEPLOY_BACKUP_ROOT:-/var/backups/prep-sheet}
nginx=${DEPLOY_NGINX_FILE:-/etc/nginx/conf.d/prep-sheet.conf}
image="ghcr.io/danielsayer/kitchenbinder@$digest"
exec 9>"$config/deployment.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 75; }
temporary=$(mktemp -d "$config/.release-XXXXXXXX")
export DOCKER_CONFIG="$temporary/docker"
mkdir -m 700 "$DOCKER_CONFIG"
maintenance=0
candidate_started=0
backup_container="prep-sheet-backup-$$"
extract_container="prep-sheet-extract-$$"

compose() {
  docker compose --project-name deploy --env-file "$config/runtime.env" \
    --env-file "$config/capacity.env" -f "$app/deploy/compose.yml" "$@"
}
database() {
  docker run --rm --memory 192m --cpus 0.5 --env-file "$config/migrate.env" "$1" \
    node packages/db/scripts/migrate.mjs "${@:2}"
}
maintenance_on() {
  install -m 644 "$config/nginx-maintenance.conf" "$nginx"
  nginx -t && systemctl reload nginx
}
cleanup() {
  docker rm -f "$backup_container" "$extract_container" >/dev/null 2>&1 || true
  rm -rf -- "$temporary"
}
failure() {
  trap - ERR HUP INT TERM
  set +e
  echo 'Deployment failed.' >&2
  if [[ $maintenance == 1 ]]; then
    maintenance_on
    # A committed migration can make the old image incompatible. Never roll back
    # data or migration history automatically; reopen only after old-image verify.
    if [[ $candidate_started == 1 ]]; then compose stop; fi
    if database "$previous" --verify && \
      install -m 600 "$temporary/runtime.env" "$config/runtime.env" && \
      install -m 644 "$temporary/compose-before.yml" "$app/deploy/compose.yml" && \
      compose up -d --wait --wait-timeout 150 web worker; then
      install -m 644 "$temporary/nginx.conf" "$nginx"
      nginx -t && systemctl reload nginx
      echo 'Previous release recovered.' >&2
    else
      echo 'Maintenance remains enabled. Migration-compatible recovery requires operator action.' >&2
    fi
  fi
  exit 1
}
trap cleanup EXIT
trap failure ERR HUP INT TERM

for file in runtime.env capacity.env migrate.env backup.env nginx-maintenance.conf nginx-serving.conf; do
  [[ -s "$config/$file" ]]
done
[[ -s "$nginx" && -s "$app/deploy/compose.yml" ]]
docker login ghcr.io -u "$actor" --password-stdin >/dev/null
docker pull "$image"
actual_revision=$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ "$actual_revision" == "$revision" ]]
docker create --name "$extract_container" "$image" >/dev/null
docker cp "$extract_container:/app/deploy/compose.yml" "$temporary/compose.yml"
docker rm "$extract_container" >/dev/null
PREP_SHEET_IMAGE="$image" docker compose --project-name deploy \
  --env-file "$config/runtime.env" --env-file "$config/capacity.env" \
  -f "$temporary/compose.yml" config --quiet
nginx -t

if [[ $mode == check ]]; then
  echo "Deployment access and configuration checked for $revision. No services stopped or database commands run."
  exit 0
fi

previous=$(compose config --images | sort -u)
[[ -n "$previous" && "$previous" != *$'\n'* ]]
docker image inspect "$previous" >/dev/null
docker pull postgres:18
install -m 600 "$config/runtime.env" "$temporary/runtime.env"
install -m 644 "$app/deploy/compose.yml" "$temporary/compose-before.yml"
# A failed, migration-incompatible release can leave the active file in
# maintenance. Forward repairs must reopen the last accepted serving config.
install -m 644 "$config/nginx-serving.conf" "$temporary/nginx.conf"
mkdir -p -m 700 "$backups" "$config/releases"
release_record="$config/releases/$(date -u +%Y%m%dT%H%M%SZ)-$revision"
mkdir -m 700 "$release_record"
cp "$temporary/runtime.env" "$temporary/compose-before.yml" "$temporary/nginx.conf" "$release_record/"
printf '%s\n' "$previous" > "$release_record/previous-image"
printf '%s\n' "$image" > "$release_record/candidate-image"

maintenance=1
maintenance_on
# Compose honours the existing 40s web / 200s worker shutdown grace periods.
compose stop
archive="$backups/$(basename "$release_record").dump"
timeout 300 docker run --rm --name "$backup_container" --memory 128m --cpus 0.5 \
  --env-file "$config/backup.env" -e PGSSLROOTCERT=system -v /etc/ssl/certs:/etc/ssl/certs:ro postgres:18 \
  sh -ec 'exec pg_dump --dbname "${BACKUP_SOURCE_DATABASE_URL:-$DATABASE_URL}" --format=custom --no-owner --no-acl --lock-wait-timeout=10s' \
  > "$archive.partial"
[[ -s "$archive.partial" ]]
docker run --rm -i --memory 128m postgres:18 pg_restore --list < "$archive.partial" >/dev/null
mv "$archive.partial" "$archive"
sha256sum "$archive" > "$release_record/backup.sha256"

database "$image"
database "$image" --verify
docker run --rm --memory 192m --env-file "$config/migrate.env" "$image" \
  node --input-type=module -e '
import { connect } from "./packages/db/scripts/migrate.mjs";
const db = connect(process.env.DATABASE_URL);
try {
  await db.connect();
  await db.query(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO prep_sheet_runtime;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO prep_sheet_runtime;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO prep_sheet_backup;
    GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO prep_sheet_backup;
    REVOKE ALL ON TABLE public.prep_sheet_migration FROM prep_sheet_runtime;
    GRANT SELECT ON TABLE public.prep_sheet_migration TO prep_sheet_runtime;
  `);
} catch { console.error("Release grants failed."); process.exitCode = 1; }
finally { await db.end(); }
'
python3 - "$config/runtime.env" "$image" <<'PY'
import os, pathlib, sys
path = pathlib.Path(sys.argv[1])
lines = path.read_text().splitlines()
assert sum(line.startswith('PREP_SHEET_IMAGE=') for line in lines) == 1
lines = ['PREP_SHEET_IMAGE=' + sys.argv[2] if line.startswith('PREP_SHEET_IMAGE=') else line for line in lines]
temporary = path.with_suffix('.env.new')
temporary.write_text('\n'.join(lines) + '\n')
temporary.chmod(0o600)
os.replace(temporary, path)
PY
install -m 644 "$temporary/compose.yml" "$app/deploy/compose.yml"
candidate_started=1
compose up -d --wait --wait-timeout 150 web worker
install -m 644 "$temporary/nginx.conf" "$nginx"
nginx -t
systemctl reload nginx
curl --fail --silent --show-error --retry 3 --max-time 20 https://kitchenbinder.app/health/ready >/dev/null
printf '%s\n' "$revision" > "$release_record/completed"
maintenance=0
echo "Deployed $revision. Both services healthy; public readiness passed."

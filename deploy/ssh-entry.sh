#!/bin/bash
# Forced command for the dedicated SSH key. No arbitrary shell or forwarding.
set -euo pipefail
read -r -a arguments <<< "${SSH_ORIGINAL_COMMAND:-}"
[[ ${#arguments[@]} == 4 ]]
[[ ${arguments[0]} =~ ^(check|deploy)$ ]]
[[ ${arguments[1]} =~ ^sha256:[a-f0-9]{64}$ ]]
[[ ${arguments[2]} =~ ^[a-f0-9]{40}$ ]]
[[ ${arguments[3]} =~ ^[a-zA-Z0-9-]+$ ]]
exec sudo -n /usr/local/sbin/prep-sheet-release "${arguments[@]}"

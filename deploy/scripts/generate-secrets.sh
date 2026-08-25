#!/bin/sh
set -eu

secret_dir="${1:-/etc/mytoken/secrets}"
umask 077
mkdir -p "$secret_dir"

create_secret() {
  destination="$1"
  prefix="$2"
  if [ -e "$destination" ]; then
    printf '%s\n' "Refusing to overwrite existing secret: $destination" >&2
    return 1
  fi
  random_value="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  printf '%s%s' "$prefix" "$random_value" > "$destination"
  chmod 0600 "$destination"
}

create_secret "$secret_dir/session-secret" ""
create_secret "$secret_dir/key-pepper" ""
create_secret "$secret_dir/bootstrap-token" "myb_"

printf '%s\n' "Secrets created under $secret_dir"
printf '%s\n' "Read bootstrap-token once on the trusted server and enter it on the setup page."

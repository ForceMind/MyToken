#!/bin/sh
set -eu

codex_bin="${MYTOKEN_CODEX_BIN:-codex}"
version_output="$($codex_bin --version)"
codex_version="$(printf '%s' "$version_output" | sed -E 's/.* ([0-9]+\.[0-9]+\.[0-9]+)$/\1/')"

case "$codex_version" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *)
    printf '%s\n' "Could not parse Codex version from: $version_output" >&2
    exit 1
    ;;
esac

contract_root="contracts/codex/$codex_version"
if [ -e "$contract_root" ]; then
  printf '%s\n' "Contract already exists: $contract_root" >&2
  printf '%s\n' "Generate into a new version directory; do not overwrite a pinned contract." >&2
  exit 1
fi

mkdir -p "$contract_root/stable-json" "$contract_root/experimental-json"
mkdir -p "$contract_root/stable-typescript" "$contract_root/experimental-typescript"

"$codex_bin" app-server generate-json-schema --out "$contract_root/stable-json"
"$codex_bin" app-server generate-json-schema --experimental --out "$contract_root/experimental-json"
"$codex_bin" app-server generate-ts --out "$contract_root/stable-typescript"
"$codex_bin" app-server generate-ts --experimental --out "$contract_root/experimental-typescript"

node scripts/write-contract-manifest.mjs "$codex_version" "$contract_root"
printf '%s\n' "Generated and pinned Codex contract: $contract_root"

#!/bin/sh
set -eu

OWNER_EMAIL='release-smoke@crook.invalid'
HUB_ORIGIN='https://crook.invalid'

fail() {
  printf 'crook smoke: %s\n' "$*" >&2
  exit 1
}

[ "$#" -eq 4 ] ||
  fail 'usage: smoke.sh <artifact directory> <target> <version> <free port>, and the port must be free on this machine.'

directory="$(cd "$1" && pwd)"
target="$2"
version="$3"
port="$4"
hub="$directory/crook-hub-$target"
work="$(mktemp -d)"
hub_pid=''

stop_hub() {
  [ -z "$hub_pid" ] || kill "$hub_pid" 2>/dev/null || true
  [ -z "$hub_pid" ] || wait "$hub_pid" 2>/dev/null || true
  rm -rf "$work"
}

trap stop_hub EXIT
trap 'exit 1' HUP INT TERM

for app in agent hub; do
  reported="$("$directory/crook-$app-$target" --version)" ||
    fail "crook-$app-$target --version failed."
  [ "$reported" = "crook-$app v$version" ] ||
    fail "crook-$app-$target reports \"$reported\" rather than crook-$app v$version."
done

hook_output="$(printf '{}' | CROOK_HOOK_SOCKET_PATH="$work/no-agent.sock" "$directory/crook-agent-$target" hook 2>&1)" ||
  fail "crook-agent-$target hook did not exit 0 with no agent listening."
[ -z "$hook_output" ] || fail "crook-agent-$target hook printed \"$hook_output\"; it must stay silent."

unset CROOK_WEB_ROOT

(
  cd "$work"
  CROOK_HUB_PORT="$port" \
    CROOK_OWNER_EMAIL="$OWNER_EMAIL" \
    CROOK_HUB_ORIGIN="$HUB_ORIGIN" \
    CROOK_HUB_DATABASE_PATH="$work/hub.sqlite" \
    exec "$hub"
) >"$work/hub.log" 2>&1 &
hub_pid=$!

until grep -q 'Listening on' "$work/hub.log"; do
  kill -0 "$hub_pid" 2>/dev/null || fail "crook-hub-$target exited before it listened: $(cat "$work/hub.log")"
  sleep 1
done

fetch() {
  curl --silent --show-error --fail \
    --header "X-ExeDev-Email: $OWNER_EMAIL" \
    --header "Origin: $HUB_ORIGIN" \
    --dump-header "$work/headers" \
    --output "$work/body" \
    "http://127.0.0.1:$port$1" || fail "crook-hub-$target did not serve $1 from its embedded web build."
}

fetch /
grep -qi '^content-security-policy:' "$work/headers" ||
  fail "crook-hub-$target served / without a Content-Security-Policy header."
asset="$(grep -o '/assets/[^"]*\.js' "$work/body" | head -n 1)"
[ -n "$asset" ] || fail "the page crook-hub-$target served at / names no script under /assets/."

fetch "$asset"
grep -qi '^cache-control:.*immutable' "$work/headers" ||
  fail "crook-hub-$target served $asset without its immutable Cache-Control header."

printf 'crook smoke: crook-agent-%s and crook-hub-%s %s run, and the hub serves its embedded web build.\n' "$target" "$target" "$version"

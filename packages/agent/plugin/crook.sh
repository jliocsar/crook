#!/bin/sh
set -eu

plugin_root="$(cd "$(dirname "$0")" && pwd)"
installer="$plugin_root/../../release/install.sh"
install_directory="${CROOK_INSTALL_DIR:-$HOME/.local/bin}"
terminal_settings=''
answer=''
key=''

say() {
  printf '%s\n' "$*"
}

restore_terminal() {
  if [ -n "$terminal_settings" ]; then
    stty "$terminal_settings"
    terminal_settings=''
  fi
}

trap restore_terminal EXIT
trap 'exit 1' HUP INT TERM

agent_program() {
  if [ -x "$install_directory/crook-agent" ]; then
    printf '%s\n' "$install_directory/crook-agent"
  else
    command -v crook-agent
  fi
}

ask() {
  printf '%s' "$1"
  IFS= read -r answer || answer=''
}

ask_secret() {
  printf '%s' "$1"
  if [ -t 0 ]; then
    terminal_settings="$(stty -g)"
    stty -echo
  fi
  IFS= read -r answer || answer=''
  if [ -t 0 ]; then
    restore_terminal
    printf '\n'
  fi
}

wait_for_key() {
  printf '%s' "$1"
  if [ -t 0 ]; then
    terminal_settings="$(stty -g)"
    stty -icanon -echo min 1
    key="$(dd bs=1 count=1 2>/dev/null)" || key=''
    restore_terminal
    printf '\n'
  else
    IFS= read -r key || key=''
  fi
}

finish() {
  wait_for_key 'Press any key to close. '
  exit "$1"
}

clear_screen() {
  if [ -t 1 ]; then
    printf '\033[H\033[2J'
  fi
}

not_installed() {
  say 'crook-agent is not installed on this machine. Run "crook: connect to hub" to install it and connect it to your hub.'
}

show_status() {
  if agent="$(agent_program)"; then
    "$agent" status || true
  else
    not_installed
  fi
}

status_loop() {
  while :; do
    clear_screen
    show_status
    say ''
    wait_for_key 'Press r to refresh, any other key to close. '
    case "$key" in
      r | R) ;;
      *) exit 0 ;;
    esac
  done
}

install_agent() {
  if [ ! -f "$installer" ]; then
    say "This plugin's checkout has no installer at $installer, so nothing was installed. Reinstall the plugin with: herdr plugin install jliocsar/crook/packages/agent/plugin"
    return 1
  fi
  sh "$installer" "$@"
}

startup() {
  if agent="$(agent_program)"; then
    exec "$agent" start
  fi
  say 'crook-agent is not installed on this machine, so there is nothing to start.'
}

open_pane() {
  exec "${HERDR_BIN_PATH:-herdr}" plugin pane open --plugin "${HERDR_PLUGIN_ID:-crook}" --entrypoint "$1" --cwd "$plugin_root"
}

connect() {
  say 'Connect this machine to a crook hub.'
  say 'The crook app shows the hub address under Machines, in "Add a machine".'
  say ''
  if ! agent="$(agent_program)"; then
    ask 'crook-agent is not installed on this machine. Install the latest release now? [y/N] '
    case "$answer" in
      y | Y | yes) ;;
      *)
        say 'Nothing was installed or changed.'
        finish 1
        ;;
    esac
    install_agent agent || finish 1
    agent="$(agent_program)" || {
      say "The installer finished, but no crook-agent is in $install_directory or on PATH, so nothing was connected."
      finish 1
    }
    say ''
  fi
  ask 'Hub address (wss://<hub>/rpc/agent): '
  hub_url="$answer"
  if [ -z "$hub_url" ]; then
    say 'No hub address was given, so nothing was changed.'
    finish 1
  fi
  ask_secret "exe.dev token for the hub VM, minted with this machine's name (hidden as you type): "
  hub_token="$answer"
  if [ -z "$hub_token" ]; then
    say 'No token was given, so nothing was changed.'
    finish 1
  fi
  default_machine="$(uname -n)"
  ask "This machine's name, the one the token was minted with [$default_machine]: "
  machine="${answer:-$default_machine}"
  say ''
  if CROOK_HUB_URL="$hub_url" CROOK_HUB_TOKEN="$hub_token" CROOK_MACHINE_ID="$machine" "$agent" install-service; then
    finish 0
  fi
  finish 1
}

restart() {
  if ! agent="$(agent_program)"; then
    not_installed
    finish 1
  fi
  "$agent" restart || true
  say ''
  "$agent" status || true
  say ''
  wait_for_key 'Press r to refresh, any other key to close. '
  case "$key" in
    r | R) status_loop ;;
    *) exit 0 ;;
  esac
}

update() {
  if agent="$(agent_program)"; then
    say "Installed: $("$agent" --version)"
  else
    say 'crook-agent is not installed on this machine yet.'
  fi
  ask 'Version to install, such as 0.1.0 (leave empty for the latest release): '
  if [ -n "$answer" ]; then
    set -- --version "$answer" agent
  else
    set -- agent
  fi
  install_agent "$@" || finish 1
  say ''
  if agent="$(agent_program)"; then
    "$agent" restart || true
  fi
  finish 0
}

case "${1:-}" in
  startup) startup ;;
  open) open_pane "${2:?open needs a pane: connect, status, restart or update}" ;;
  connect) connect ;;
  status) status_loop ;;
  restart) restart ;;
  update) update ;;
  *)
    say 'Usage: crook.sh startup | open <pane> | connect | status | restart | update' >&2
    exit 2
    ;;
esac

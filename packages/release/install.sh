#!/bin/sh
set -eu

REPOSITORY='jliocsar/crook'
RELEASE_WORKFLOW='.github/workflows/release.yml'
OIDC_ISSUER='https://token.actions.githubusercontent.com'
CHECKSUMS='SHA256SUMS'
CHECKSUMS_BUNDLE='SHA256SUMS.sigstore.json'
COSIGN_VERSION='v3.0.6'
COSIGN_SHA256_LINUX_AMD64='c956e5dfcac53d52bcf058360d579472f0c1d2d9b69f55209e256fe7783f4c74'
COSIGN_SHA256_LINUX_ARM64='bedac92e8c3729864e13d4a17048007cfafa79d5deca993a43a90ffe018ef2b8'
COSIGN_SHA256_DARWIN_ARM64='5fadd012ae6381a6a29ff86a7d39aa873878852f1073fc90b15995961ecfb084'

install_directory="${CROOK_INSTALL_DIR:-$HOME/.local/bin}"
cache_directory="${XDG_CACHE_HOME:-$HOME/.cache}/crook"
version=''
apps=''

say() {
  printf 'crook install: %s\n' "$*"
}

fail() {
  printf 'crook install: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage: install.sh [--version X.Y.Z] [agent] [hub]

Downloads the crook release binaries for this machine, checks that the release
workflow of $REPOSITORY signed them, and installs them into $install_directory
(set CROOK_INSTALL_DIR to install elsewhere). Installs the agent when no app is
named, and the latest release without --version. Nothing updates on its own:
run this again to update.

Downloads go to a directory under $cache_directory, removed
when the installer ends, and each binary is run from there once, with --version,
before it is installed. The signature is checked with cosign $COSIGN_VERSION,
downloaded once into $cache_directory and checked against its pinned SHA-256. Set CROOK_COSIGN to
the path of a cosign you trust to use that one instead.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || fail '--version needs a version, such as --version 0.1.0.'
      version="$2"
      shift 2
      ;;
    --version=*)
      version="${1#--version=}"
      shift
      ;;
    agent | hub)
      apps="$apps $1"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "unknown argument $1."
      ;;
  esac
done

[ -n "$apps" ] || apps='agent'

case "$(uname -s)" in
  Linux) platform='linux' ;;
  Darwin) platform='darwin' ;;
  *) fail "crook releases no build for $(uname -s)." ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) architecture='x64' ;;
  aarch64 | arm64) architecture='arm64' ;;
  *) fail "crook releases no build for $(uname -m)." ;;
esac

target="$platform-$architecture"

case "$target" in
  linux-x64)
    cosign_artifact='cosign-linux-amd64'
    cosign_sha256="$COSIGN_SHA256_LINUX_AMD64"
    ;;
  linux-arm64)
    cosign_artifact='cosign-linux-arm64'
    cosign_sha256="$COSIGN_SHA256_LINUX_ARM64"
    ;;
  darwin-arm64)
    cosign_artifact='cosign-darwin-arm64'
    cosign_sha256="$COSIGN_SHA256_DARWIN_ARM64"
    ;;
  *) fail "crook releases no build for $target: the release targets are linux-x64, linux-arm64 and darwin-arm64." ;;
esac

has() {
  command -v "$1" >/dev/null 2>&1
}

sha256_of() {
  if has sha256sum; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

latest_tag() {
  if has gh; then
    gh release view --repo "$REPOSITORY" --json tagName --jq .tagName
  else
    curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPOSITORY/releases/latest" | sed 's#.*/tag/##'
  fi
}

download() {
  if has gh; then
    gh release download "v$version" --repo "$REPOSITORY" --pattern "$1" --dir "$work" --clobber ||
      fail "could not download $1 of v$version with gh. Check that gh is logged in (gh auth status) and can read $REPOSITORY."
  else
    curl -fsSL -o "$work/$1" "https://github.com/$REPOSITORY/releases/download/v$version/$1" ||
      fail "could not download $1 of v$version. $REPOSITORY is private, so install the GitHub CLI, log in with gh auth login and run this again."
  fi
}

trusted_cosign() {
  if [ -n "${CROOK_COSIGN:-}" ]; then
    printf '%s\n' "$CROOK_COSIGN"
    return
  fi

  cached="$cache_directory/cosign-$COSIGN_VERSION-$target"

  if [ -x "$cached" ] && [ "$(sha256_of "$cached")" = "$cosign_sha256" ]; then
    printf '%s\n' "$cached"
    return
  fi

  has curl || fail "checking the signature needs cosign, and downloading cosign needs curl. Install curl, or set CROOK_COSIGN to a cosign you trust."
  curl -fsSL -o "$work/cosign" "https://github.com/sigstore/cosign/releases/download/$COSIGN_VERSION/$cosign_artifact" ||
    fail "could not download cosign $COSIGN_VERSION to check the signature."
  [ "$(sha256_of "$work/cosign")" = "$cosign_sha256" ] ||
    fail "the downloaded cosign $COSIGN_VERSION does not match its pinned SHA-256, so nothing was installed."
  chmod 755 "$work/cosign"
  mv -f "$work/cosign" "$cached"
  printf '%s\n' "$cached"
}

if [ -z "$version" ]; then
  tag="$(latest_tag)" || fail "could not find the latest release of $REPOSITORY."
  version="${tag#v}"
fi

printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' ||
  fail "$version is not a crook version: crook versions are a plain major.minor.patch, such as 0.1.0."

mkdir -p "$cache_directory"
work="$(mktemp -d "$cache_directory/install.XXXXXX")"
trap 'rm -rf "$work"' EXIT
trap 'exit 1' HUP INT TERM

names=''

for app in $apps; do
  names="$names crook-$app"
done

say "installing$names $version for $target"

download "$CHECKSUMS"
download "$CHECKSUMS_BUNDLE"

for app in $apps; do
  download "crook-$app-$target"
done

cosign="$(trusted_cosign)"
"$cosign" verify-blob \
  --bundle "$work/$CHECKSUMS_BUNDLE" \
  --certificate-identity "https://github.com/$REPOSITORY/$RELEASE_WORKFLOW@refs/tags/v$version" \
  --certificate-oidc-issuer "$OIDC_ISSUER" \
  "$work/$CHECKSUMS" >/dev/null ||
  fail "the checksums of v$version are not signed by the release workflow of $REPOSITORY for that tag, so nothing was installed."

for app in $apps; do
  artifact="crook-$app-$target"
  expected="$(awk -v name="$artifact" '$2 == name { print $1 }' "$work/$CHECKSUMS")"
  [ -n "$expected" ] || fail "the signed checksums of v$version list no $artifact, so nothing was installed."
  [ "$(sha256_of "$work/$artifact")" = "$expected" ] ||
    fail "$artifact does not match its signed checksum, so nothing was installed."
  chmod 755 "$work/$artifact"
  reported="$("$work/$artifact" --version)" ||
    fail "$artifact did not run from $work, so nothing was installed. That directory must allow running programs, as a noexec mount does not."
  [ "$reported" = "crook-$app v$version" ] ||
    fail "$artifact reports \"$reported\" rather than crook-$app v$version, so nothing was installed."
done

mkdir -p "$install_directory"

for app in $apps; do
  cp "$work/crook-$app-$target" "$install_directory/.crook-$app.new"
  mv -f "$install_directory/.crook-$app.new" "$install_directory/crook-$app"
  say "installed $install_directory/crook-$app $version"
done

case ":$PATH:" in
  *":$install_directory:"*) ;;
  *) say "$install_directory is not on PATH; add it to run crook-agent and crook-hub by name." ;;
esac

say 'a crook-agent or crook-hub that is already running keeps its old version until it restarts.'

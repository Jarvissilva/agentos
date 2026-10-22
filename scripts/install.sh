#!/usr/bin/env bash
set -euo pipefail

# Environment and command-line overrides support installing forks.
repository="${AGENTOS_REPOSITORY:-Jarvissilva/agentos}"
version=latest
stage=
lock=
activated=false
finished=false

fail() { printf 'agentos installer: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage: bash scripts/install.sh [--repo OWNER/REPO] [--version vX.Y.Z]

Install a published GitHub release (latest by default) into ~/.local/lib/agentos.
Defaults to Jarvissilva/agentos. AGENTOS_REPOSITORY or --repo can override it.
Requires Linux, Bash, curl, tar, gzip, stty, and setsid; unzip if Bun is missing.
Installs Bun 1.4.3 through its official installer when no existing Bun is found.
Does not install providers, sign in, or enable the scheduler.
EOF
}

while (($#)); do
  case "$1" in
    --repo|--version)
      (($# >= 2)) || fail "$1 requires a value"
      if [[ "$1" == --repo ]]; then repository=$2; else version=$2; fi
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown argument: $1 (use --help)" ;;
  esac
done

[[ "$repository" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$ ]] ||
  fail 'Specify the public GitHub repository with --repo OWNER/REPO.'
[[ "$version" == latest || "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] ||
  fail 'Version must be latest or a release tag such as v0.1.0.'
[[ "$(uname -s)" == Linux ]] || fail 'Only Linux is supported.'
[[ "${HOME:-}" == /* ]] || fail 'HOME must be an absolute path.'

missing=()
for tool in curl tar gzip stty setsid; do
  command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
done
((${#missing[@]} == 0)) || fail "Missing tools: ${missing[*]}. Install curl, tar, gzip, GNU coreutils, and util-linux using your Linux package manager, then retry."

install_dir="$HOME/.local/lib/agentos"
bin_dir="$HOME/.local/bin"
launcher="$bin_dir/agentos"
[[ ! -e "$install_dir" && ! -L "$install_dir" ]] ||
  fail "$install_dir already exists. This installer only supports fresh installations; see README for manual upgrades."
[[ ! -e "$launcher" && ! -L "$launcher" ]] ||
  fail "$launcher already exists. Preserve or remove the existing command yourself before installing."

cleanup() {
  [[ -z "$stage" ]] || rm -rf -- "$stage"
  if [[ "$activated" == true && "$finished" == false ]]; then
    rm -rf -- "$install_dir"
  fi
  [[ -z "$lock" ]] || rmdir -- "$lock"
  return 0
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
umask 077
mkdir -p -- "$HOME/.local/lib" "$bin_dir"
mkdir -- "$HOME/.local/lib/.agentos-install.lock" 2>/dev/null ||
  fail 'Another installer may be running (.local/lib/.agentos-install.lock exists).'
lock="$HOME/.local/lib/.agentos-install.lock"
stage=$(mktemp -d "$HOME/.local/lib/.agentos-install.XXXXXXXX")

download() {
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' "$@"
}
if [[ "$version" == latest ]]; then
  release_url=$(download --output /dev/null --write-out '%{url_effective}' "https://github.com/$repository/releases/latest")
  version=${release_url##*/}
  [[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] ||
    fail 'Could not resolve the latest published release. Use --version vX.Y.Z.'
fi
printf 'Installing AgentOS %s from %s\n' "$version" "$repository"
download --output "$stage/release.tar.gz" "https://github.com/$repository/archive/refs/tags/$version.tar.gz"
mkdir -- "$stage/app"
tar --extract --gzip --file "$stage/release.tar.gz" --directory "$stage/app" --strip-components=1 --no-same-owner --no-same-permissions
for file in package.json bun.lock src/index.ts src/tui/app.tsx src/lib/storage/migrations/meta/_journal.json; do
  [[ -f "$stage/app/$file" && ! -L "$stage/app/$file" ]] || fail "Release is missing $file."
done

bun=$(command -v bun || true)
bun_home="${BUN_INSTALL:-$HOME/.bun}"
[[ "$bun_home" == /* ]] || fail 'BUN_INSTALL must be an absolute path when set.'
if [[ -z "$bun" && -x "$bun_home/bin/bun" ]]; then bun="$bun_home/bin/bun"; fi
if [[ -z "$bun" ]]; then
  command -v unzip >/dev/null 2>&1 || fail 'Installing Bun requires unzip. Install it using your Linux package manager, then retry.'
  [[ ! -e "$bun_home/bin/bun" && ! -L "$bun_home/bin/bun" ]] || fail "Cannot overwrite $bun_home/bin/bun."
  printf 'Installing Bun 1.4.3 using https://bun.sh/install\n'
  download --output "$stage/install-bun.sh" https://bun.sh/install
  BUN_INSTALL="$bun_home" bash "$stage/install-bun.sh" bun-v1.4.3
  bun="$bun_home/bin/bun"
fi
[[ "$bun" == /* && -x "$bun" ]] || fail 'Bun must resolve to an executable at an absolute path.'
bun_version=$("$bun" --version)
if [[ "$bun_version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  major=${BASH_REMATCH[1]}; minor=${BASH_REMATCH[2]}; patch=${BASH_REMATCH[3]}
  ((major > 1 || (major == 1 && (minor > 3 || (minor == 3 && patch >= 14))))) ||
    fail "Bun $bun_version is too old. Upgrade to Bun >=1.3.14 and retry."
else
  fail "Unsupported Bun version: $bun_version. Use stable Bun >=1.3.14."
fi
(
  cd -- "$stage/app"
  "$bun" install --frozen-lockfile
)

# The launcher uses absolute paths but deliberately preserves the caller's cwd.
printf '#!/usr/bin/env bash\n# Managed by agentos installer\nexec %q %q "$@"\n' \
  "$bun" "$install_dir/src/index.ts" > "$stage/launcher"
chmod 755 "$stage/launcher"
[[ ! -e "$install_dir" && ! -L "$install_dir" ]] || fail 'Installation path appeared during setup; refusing to replace it.'
mv --no-clobber --no-target-directory -- "$stage/app" "$install_dir"
[[ ! -d "$stage/app" ]] || fail 'Installation path appeared during setup; refusing to replace it.'
activated=true
# A hard link publishes the complete launcher without replacing any existing path.
ln -- "$stage/launcher" "$launcher"
finished=true

printf '\nInstalled AgentOS %s. Run: %q\n' "$version" "$launcher"
case ":${PATH:-}:" in
  *":$bin_dir:"*) printf 'You can also run: agentos\n' ;;
  *)
    printf '\nAdd ~/.local/bin to PATH in your shell configuration:\n'
    if [[ "${SHELL:-}" == */fish ]]; then
      printf '  fish_add_path "$HOME/.local/bin"\n'
    else
      printf '  export PATH="$HOME/.local/bin:$PATH"\n'
    fi
    printf 'Then open a new terminal, or run the absolute command above now.\n'
    ;;
esac
provider_found=false
for provider in codex opencode agy; do
  if command -v "$provider" >/dev/null 2>&1; then provider_found=true; fi
done
if [[ "$provider_found" == false ]]; then
  printf '\nInstall Codex, OpenCode, or Agy and sign in using its own CLI before starting a session.\n'
fi
if command -v agy >/dev/null 2>&1 && ! command -v tmux >/dev/null 2>&1; then
  printf '\nAgy embedded sessions also require tmux; install it using your package manager.\n'
fi

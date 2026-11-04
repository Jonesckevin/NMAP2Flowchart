#!/bin/sh
# Adds the NMAP import plugin to an existing draw.io (jgraph/drawio) container.
#
#   ./install-plugin.sh -c nmap2drawio
#   ./install-plugin.sh -c drawio -u http://drawio.lab:8080
#   ./install-plugin.sh -c drawio --no-auto-load     # enable Extras > Plugins only
#   ./install-plugin.sh -c drawio --uninstall
#
# Copies plugins/nmap2drawio.js into the container, enables third-party plugins
# (window.ALLOW_CUSTOM_PLUGINS) and, unless --no-auto-load is given, loads the
# plugin from js/PostConfig.js on every page load.
#
# Everything is idempotent: one marked block per file, skipped when present.
# --uninstall strips both blocks and deletes the copied files again.
#
# Files copied with `docker cp` live in the container layer: they survive a
# restart but not `docker rm` / `docker compose up --build`. Re-run this script
# after recreating the container, or mount the files for good (see README.md).

set -eu

CONTAINER=""
BASE_URL=""
WEBAPP_DIR=""
AUTO_LOAD=1
UNINSTALL=0

usage() {
  cat <<'EOF'
Usage: install-plugin.sh [options]

  -c, --container NAME   running draw.io container (default: the only one running)
  -u, --base-url URL     address to print in the instructions
                         (default: the container's published 8080 port on localhost)
  -w, --webapp-dir PATH  webapp root inside the container
                         (default: autodetected, usually /usr/local/tomcat/webapps/draw)
      --no-auto-load     enable Extras > Plugins but let each browser add the plugin
      --uninstall        remove the plugin and restore the stock draw.io files
  -h, --help             this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -c|--container) CONTAINER="${2:-}"; shift 2 ;;
    -u|--base-url) BASE_URL="${2:-}"; shift 2 ;;
    -w|--webapp-dir) WEBAPP_DIR="${2:-}"; shift 2 ;;
    --no-auto-load) AUTO_LOAD=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PLUGIN_FILE="$SCRIPT_DIR/plugins/nmap2drawio.js"
SAMPLE_FILE="$SCRIPT_DIR/samples/lab-scan.xml"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

step() { printf '  %s\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Container
# ---------------------------------------------------------------------------
docker version --format '{{.Server.Version}}' >/dev/null 2>&1 ||
  fail 'Docker is not reachable. Start Docker and try again.'

if [ -z "$CONTAINER" ]; then
  DRAWIO=$(docker ps --filter ancestor=jgraph/drawio --format '{{.Names}}' 2>/dev/null || true)
  RUNNING=$(docker ps --format '{{.Names}}' 2>/dev/null || true)
  DRAWIO_COUNT=$(printf '%s\n' "$DRAWIO" | grep -c . || true)
  RUNNING_COUNT=$(printf '%s\n' "$RUNNING" | grep -c . || true)
  if [ "$DRAWIO_COUNT" -eq 1 ]; then
    CONTAINER="$DRAWIO"
  elif [ "$RUNNING_COUNT" -eq 1 ]; then
    CONTAINER="$RUNNING"
  elif [ "$RUNNING_COUNT" -eq 0 ]; then
    fail 'No running container found. Start draw.io first, then pass -c <name>.'
  else
    fail "Several containers are running; pick one with -c <name>:
$(printf '%s\n' "$RUNNING" | sed 's/^/  /')"
  fi
fi

[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null || echo false)" = "true" ] ||
  fail "Container '$CONTAINER' is not running."
step "container  $CONTAINER"

# ---------------------------------------------------------------------------
# 2. Webapp root
# ---------------------------------------------------------------------------
if [ -z "$WEBAPP_DIR" ]; then
  FOUND=$(docker exec "$CONTAINER" sh -c \
    'ls -d /usr/local/tomcat/webapps/*/js/PostConfig.js 2>/dev/null | head -n 1' || true)
  [ -n "$FOUND" ] || fail "Could not find <webapp>/js/PostConfig.js inside '$CONTAINER'.
Pass it explicitly, for example -w /usr/local/tomcat/webapps/draw."
  WEBAPP_DIR=${FOUND%/js/PostConfig.js}
fi
step "webapp     $WEBAPP_DIR"

PRE_CONFIG="$WEBAPP_DIR/js/PreConfig.js"
POST_CONFIG="$WEBAPP_DIR/js/PostConfig.js"
PLUGIN_PATH="$WEBAPP_DIR/plugins/nmap2drawio.js"
SAMPLE_PATH="$WEBAPP_DIR/plugins/samples/lab-scan.xml"

if [ -z "$BASE_URL" ]; then
  PORT=$(docker port "$CONTAINER" 8080/tcp 2>/dev/null | head -n 1 | sed 's/.*://' || true)
  case "$PORT" in
    ''|*[!0-9]*) BASE_URL='http://localhost:8080' ;;
    *) BASE_URL="http://localhost:$PORT" ;;
  esac
fi

# ---------------------------------------------------------------------------
# 3. Marked blocks (shared by install and uninstall)
# ---------------------------------------------------------------------------
cat >"$TMP_DIR/preconfig.js" <<'EOF'

// --- nmap2drawio begin ---
// draw.io refuses plugins that are not built in unless this flag is set
// (js/diagramly/Init.js). It also enables Extras > Plugins, where a plugin can
// be added by URL per browser; that menu is hidden when the editor is opened
// with ?offline=1.
;window.ALLOW_CUSTOM_PLUGINS = true;
window.PLUGINS_BASE_PATH = window.PLUGINS_BASE_PATH || '';
// --- nmap2drawio end ---
EOF

cat >"$TMP_DIR/postconfig.js" <<'EOF'

// --- nmap2drawio begin ---
// Loads the nmap -> draw.io import plugin (plugins/nmap2drawio.js) on every page
// load. Drop this block, or install with --no-auto-load, to only allow the plugin
// to be added by hand under Extras > Plugins.
// The leading semicolon matters: draw.io ships files that end without one, and
// without it a following "(" would be parsed as a call on the previous line.
;(function () {
  var src = (window.PLUGINS_BASE_PATH || '') + 'plugins/nmap2drawio.js';
  if (typeof window.mxscript === 'function') {
    window.mxscript(src);
    return;
  }
  var script = document.createElement('script');
  script.src = src;
  script.async = false;
  document.head.appendChild(script);
})();
// --- nmap2drawio end ---
EOF

# Copies $1 out of the container into $2 (empty file when it does not exist).
read_remote() {
  docker cp "$CONTAINER:$1" "$2" >/dev/null 2>&1 || : >"$2"
}

add_block() { # $1 remote path, $2 local block file, $3 label
  local_file="$TMP_DIR/patched.js"
  read_remote "$1" "$local_file"
  if grep -q 'nmap2drawio begin' "$local_file"; then
    step "unchanged  $1 ($3 already enabled)"
    return
  fi
  cat "$2" >>"$local_file"
  docker cp "$local_file" "$CONTAINER:$1" >/dev/null
  step "patched    $1 ($3 enabled)"
}

# ---------------------------------------------------------------------------
# 4. Uninstall
# ---------------------------------------------------------------------------
if [ "$UNINSTALL" -eq 1 ]; then
  for FILE in "$PRE_CONFIG" "$POST_CONFIG"; do
    local_file="$TMP_DIR/stripped.js"
    read_remote "$FILE" "$local_file"
    if grep -q 'nmap2drawio begin' "$local_file"; then
      awk '
        /\/\/ --- nmap2drawio begin ---/ { skip = 1; next }
        /\/\/ --- nmap2drawio end ---/ { skip = 0; next }
        !skip { print }
      ' "$local_file" >"$TMP_DIR/stripped.out"
      mv "$TMP_DIR/stripped.out" "$local_file"
      docker cp "$local_file" "$CONTAINER:$FILE" >/dev/null
      step "restored   $FILE"
    fi
  done
  docker exec "$CONTAINER" sh -c "rm -f '$PLUGIN_PATH' '$SAMPLE_PATH'" >/dev/null
  step 'removed    plugins/nmap2drawio.js'
  step 'removed    plugins/samples/lab-scan.xml'
  echo
  echo "NMAP import plugin removed from '$CONTAINER'. Hard-reload the editor tab (Ctrl+F5)."
  exit 0
fi

# ---------------------------------------------------------------------------
# 5. Install
# ---------------------------------------------------------------------------
[ -f "$PLUGIN_FILE" ] || fail "Missing '$PLUGIN_FILE' - keep the script next to plugins/ and samples/."
[ -f "$SAMPLE_FILE" ] || fail "Missing '$SAMPLE_FILE' - keep the script next to plugins/ and samples/."

docker exec "$CONTAINER" sh -c "mkdir -p '$WEBAPP_DIR/plugins/samples'" >/dev/null
docker cp "$PLUGIN_FILE" "$CONTAINER:$PLUGIN_PATH" >/dev/null
docker cp "$SAMPLE_FILE" "$CONTAINER:$SAMPLE_PATH" >/dev/null
step 'copied     plugins/nmap2drawio.js'
step 'copied     plugins/samples/lab-scan.xml'

add_block "$PRE_CONFIG" "$TMP_DIR/preconfig.js" 'custom plugins'
if [ "$AUTO_LOAD" -eq 1 ]; then
  add_block "$POST_CONFIG" "$TMP_DIR/postconfig.js" 'plugin auto-load'
else
  step "skipped    $POST_CONFIG (auto-load disabled by --no-auto-load)"
fi

# ---------------------------------------------------------------------------
# 6. What to do next
# ---------------------------------------------------------------------------
cat <<EOF

NMAP import plugin installed in '$CONTAINER'
  webapp      $WEBAPP_DIR
  variables   window.ALLOW_CUSTOM_PLUGINS = true
              window.PLUGINS_BASE_PATH   = '' (webapp root)
  sample      plugins/samples/lab-scan.xml  ->  'Load sample scan' in the dialog

EOF

if [ "$AUTO_LOAD" -eq 1 ]; then
  echo "  use it:     open $BASE_URL/ then File > NMAP: import scan..."
  echo "  manual:     Extras > Plugins > Custom... can add it per browser too"
  echo "              (enter plugins/nmap2drawio.js, Add, Apply, reload)."
else
  echo "  manual:     open $BASE_URL/ then Extras > Plugins > Custom..., enter"
  echo "              plugins/nmap2drawio.js, click Add, Apply, then reload the tab."
fi

cat <<'EOF'

Hard-reload the editor tab (Ctrl+F5) so the patched files are fetched.
?offline=1 hides Extras > Plugins, so leave it off when adding the plugin by hand.
docker cp changes are lost when the container is recreated - re-run this script,
or mount these paths in compose (see README.md).
EOF

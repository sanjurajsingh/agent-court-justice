#!/usr/bin/env bash
# One-shot: install GLSim (no Docker), patch it for native value transfers,
# start it on :4000 with 5 validators and run the AgentCourt gltest suite.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${GLSIM_VENV:-$HOME/glenv}"
RUNNER_VERSION="v0.3.0-rc7"
CACHE="$HOME/.cache/gltest-direct"
PORT="${GLSIM_PORT:-4000}"
LOG="${GLSIM_LOG:-${TMPDIR:-/tmp}/agentcourt-glsim.log}"
PID_FILE="${GLSIM_PID_FILE:-${TMPDIR:-/tmp}/agentcourt-glsim.pid}"

fail() {
  printf 'AgentCourt tests: %s\n' "$*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required. Install it with Homebrew or your Linux package manager."
PYTHON=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))' >/dev/null 2>&1; then
    PYTHON="$candidate"
    break
  fi
done
[ -n "$PYTHON" ] || fail "Python 3.10 or newer is required. Install python3, then rerun this command."

if [ ! -x "$VENV/bin/python" ]; then
  "$PYTHON" -m venv "$VENV" || fail "Could not create $VENV. Install Python venv support and rerun."
fi

if ! "$VENV/bin/python" -c 'import glsim, gltest, numpy' >/dev/null 2>&1; then
  "$VENV/bin/python" -m pip install "genlayer-test[sim]" numpy || fail "Dependency installation failed. Check Python and network access."
fi
[ -x "$VENV/bin/glsim" ] || fail "GLSim was not installed in $VENV. Remove that environment and rerun."
[ -x "$VENV/bin/gltest" ] || fail "gltest was not installed in $VENV. Remove that environment and rerun."

"$VENV/bin/python" "$ROOT/tools/glsim_patch.py" \
  "$("$VENV/bin/python" -c 'import glsim,pathlib;print(pathlib.Path(glsim.__file__).parent)')"

# genvm no longer publishes "genvm-universal.tar.xz"; the runners bundle is the
# same payload under a new name, so cache it under the name gltest looks for.
mkdir -p "$CACHE"
if [ ! -s "$CACHE/genvm-universal-$RUNNER_VERSION.tar.xz" ]; then
  DOWNLOAD="$CACHE/genvm-universal-$RUNNER_VERSION.tar.xz.part"
  rm -f "$DOWNLOAD"
  curl -fL --retry 3 -o "$DOWNLOAD" \
    "https://github.com/genlayerlabs/genvm/releases/download/$RUNNER_VERSION/genvm-runners-all.tar.xz" \
    || fail "Could not download the GenVM runner artifact. Check network access and rerun."
  mv "$DOWNLOAD" "$CACHE/genvm-universal-$RUNNER_VERSION.tar.xz"
fi

if curl -sf -m 2 -X POST "http://127.0.0.1:$PORT/api" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' >/dev/null 2>&1; then
  fail "port $PORT already has a JSON-RPC service. Stop it or set GLSIM_PORT to a free port."
fi

GLSIM_PID=""
cleanup() {
  if [ -n "$GLSIM_PID" ] && kill -0 "$GLSIM_PID" >/dev/null 2>&1; then
    kill "$GLSIM_PID" >/dev/null 2>&1 || true
    wait "$GLSIM_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM

"$VENV/bin/glsim" --port "$PORT" --validators 5 >"$LOG" 2>&1 < /dev/null &
GLSIM_PID=$!
printf '%s\n' "$GLSIM_PID" > "$PID_FILE"

READY=0
for ((attempt = 1; attempt <= 45; attempt++)); do
  sleep 1
  if curl -sf -m 2 -X POST "http://127.0.0.1:$PORT/api" -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' >/dev/null; then
    READY=1
    break
  fi
  kill -0 "$GLSIM_PID" >/dev/null 2>&1 || break
done
[ "$READY" -eq 1 ] || {
  printf 'AgentCourt tests: GLSim did not become ready on port %s. Last log lines:\n' "$PORT" >&2
  tail -n 40 "$LOG" >&2 2>/dev/null || true
  exit 1
}

cd "$ROOT"
"$VENV/bin/gltest" "$@"

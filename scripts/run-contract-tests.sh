#!/usr/bin/env bash
# One-shot: install GLSim (no Docker), patch it for native value transfers,
# start it on :4000 with 5 validators and run the AgentCourt gltest suite.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${GLSIM_VENV:-$HOME/glenv}"
RUNNER_VERSION="v0.3.0-rc7"
CACHE="$HOME/.cache/gltest-direct"

if [ ! -x "$VENV/bin/gltest" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q "genlayer-test[sim]" numpy
fi

"$VENV/bin/python" "$ROOT/tools/glsim_patch.py" \
  "$("$VENV/bin/python" -c 'import glsim,pathlib;print(pathlib.Path(glsim.__file__).parent)')"

# genvm no longer publishes "genvm-universal.tar.xz"; the runners bundle is the
# same payload under a new name, so cache it under the name gltest looks for.
mkdir -p "$CACHE"
if [ ! -s "$CACHE/genvm-universal-$RUNNER_VERSION.tar.xz" ]; then
  curl -sL -o "$CACHE/genvm-universal-$RUNNER_VERSION.tar.xz" \
    "https://github.com/genlayerlabs/genvm/releases/download/$RUNNER_VERSION/genvm-runners-all.tar.xz"
fi

pkill -f glsim >/dev/null 2>&1 || true
sleep 1
(setsid nohup "$VENV/bin/glsim" --port 4000 --validators 5 > /tmp/glsim.log 2>&1 < /dev/null &)
for _ in $(seq 1 30); do
  sleep 1
  curl -sf -m 2 -X POST http://127.0.0.1:4000/api -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId"}' >/dev/null && break
done

cd "$ROOT"
exec "$VENV/bin/gltest" "$@"

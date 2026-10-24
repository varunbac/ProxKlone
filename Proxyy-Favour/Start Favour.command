#!/bin/zsh
cd "$(dirname "$0")" || exit 1
APP_ROOT="$(pwd -P)"
SERVER_PORT=8767
SERVER_BUILD="$(python3 -c 'import hashlib,pathlib,sys; print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest()[:16])' "$APP_ROOT/server.py")"
open_preview() {
    if ! open "$PREVIEW_URL/" >/dev/null 2>&1; then
        echo "Open this address in your browser: $PREVIEW_URL/"
    fi
}
is_current_server() {
    /usr/bin/curl --max-time 2 -fsS "$1/api/health" 2>/dev/null | python3 -c 'import json,sys
try:
    data=json.load(sys.stdin)
except (json.JSONDecodeError, OSError):
    sys.exit(1)
sys.exit(0 if data.get("application")=="proxyy-favour" and data.get("root")==sys.argv[1] and data.get("build")==sys.argv[2] else 1)' "$APP_ROOT" "$SERVER_BUILD"
}
while /usr/sbin/lsof -nP -iTCP:"$SERVER_PORT" -sTCP:LISTEN >/dev/null 2>&1; do
    PREVIEW_URL="http://127.0.0.1:$SERVER_PORT"
    if is_current_server "$PREVIEW_URL"; then
        open_preview
        echo "Hangout is already running from $APP_ROOT at $PREVIEW_URL"
        exit 0
    fi
    SERVER_PORT=$((SERVER_PORT + 1))
done
PREVIEW_URL="http://127.0.0.1:$SERVER_PORT"
PORT="$SERVER_PORT" python3 server.py >"/tmp/proxyy-favour-$SERVER_PORT.log" 2>&1 &
SERVER_PID=$!
attempt=0
while (( attempt < 40 )); do
    PREVIEW_URL="http://127.0.0.1:$SERVER_PORT"
    if is_current_server "$PREVIEW_URL"; then
        break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "Hangout could not start. Check /tmp/proxyy-favour-$SERVER_PORT.log"
        exit 1
    fi
    attempt=$((attempt + 1))
    sleep 0.25
done
if ! is_current_server "$PREVIEW_URL"; then
    echo "Hangout did not become ready. Check /tmp/proxyy-favour-$SERVER_PORT.log"
    kill "$SERVER_PID" 2>/dev/null
    exit 1
fi
open_preview
echo "Hangout is running from $APP_ROOT at $PREVIEW_URL"
echo "Keep this window open. Press Control+C to stop the local server."
trap 'kill "$SERVER_PID" 2>/dev/null' INT TERM
wait "$SERVER_PID"

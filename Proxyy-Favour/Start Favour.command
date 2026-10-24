#!/bin/zsh
cd "$(dirname "$0")" || exit 1
PREVIEW_URL="http://127.0.0.1:8766/"
if /usr/sbin/lsof -nP -iTCP:8766 -sTCP:LISTEN >/dev/null 2>&1; then
    open "$PREVIEW_URL"
    echo "Favour is already running at $PREVIEW_URL"
    exit 0
fi
python3 server.py >/tmp/favour-server.log 2>&1 &
SERVER_PID=$!
sleep 1
open "$PREVIEW_URL"
echo "Favour is running at $PREVIEW_URL"
echo "Keep this window open. Press Control+C to stop the local server."
wait "$SERVER_PID"

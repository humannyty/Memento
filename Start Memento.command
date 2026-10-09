#!/bin/bash
# Double-click to run memento on this Mac. Close this window (or press Ctrl-C) to stop.
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo "python3 not found. Run: xcode-select --install"; read -n1; exit 1; }
PORT=${PORT:-8787}
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo ""
echo "  memento is running:  http://localhost:$PORT"
[ -n "$IP" ] && echo "  friends on the same wifi:  http://$IP:$PORT"
python3 -c "import os;os.makedirs('data/uploads',exist_ok=True)"
( sleep 1.5; open "http://localhost:$PORT" ) &
( sleep 1; echo "  admin page:  http://localhost:$PORT/admin?key=$(cat data/admin_key.txt)"; echo ""; echo "  (close this window to stop)" ) &
PORT=$PORT exec python3 server.py

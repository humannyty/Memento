memento: run it on your Mac

1. Unzip, then double-click "Start Memento.command".
   (The first time, macOS may block it. If so, right-click it, choose Open, then Open again.)
2. Your browser opens http://localhost:8787. Pick a name and play.
3. Friends on the same wifi can open the "friends on the same wifi" address it prints.
   (If macOS asks whether Python can accept incoming connections, click Allow.)
4. To stop it, close the Terminal window.

Terminal alternative:  cd memento && python3 server.py
Start fresh (deletes all users and mementos):  python3 wipe.py
Different port:  PORT=9000 python3 server.py
Needs Python 3.9+ (built into macOS once Xcode command line tools are installed).

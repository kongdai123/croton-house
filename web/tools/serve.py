# Local dev server for the walkthrough: serves web/ on http://127.0.0.1:8780 and tells the browser never to cache,
# so a plain reload always picks up a fresh build (python's stock http.server lets Chrome reuse stale CSS and JS).
# usage (from web/): python3 tools/serve.py [port]
import http.server, os, sys
from functools import partial

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *args):
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8780
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
http.server.ThreadingHTTPServer(('127.0.0.1', port), partial(NoCache, directory=root)).serve_forever()

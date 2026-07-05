#!/usr/bin/env python3
"""
Run: python server.py
Port 8001. Serves static files + POST /api/save-portfolio.
"""
import json, os, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from http.server import SimpleHTTPRequestHandler, HTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8001

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_POST(self):
        if self.path != '/api/save-portfolio':
            self.send_response(404); self.end_headers(); return
        try:
            n    = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(n)
            data = json.loads(body.decode('utf-8'))
            with open(os.path.join(ROOT, 'portfolio.json'), 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            self._resp(200, {'ok': True})
        except Exception as e:
            self._resp(400, {'error': str(e)})

    def _resp(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_): pass

if __name__ == '__main__':
    with HTTPServer(('', PORT), Handler) as srv:
        print(f'Server -> http://localhost:{PORT}')
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print('Остановлен.')

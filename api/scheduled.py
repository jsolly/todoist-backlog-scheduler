# Vercel serverless function for scheduling Todoist tasks
# This endpoint can be called by Vercel cron jobs

import sys
import os
import json
from pathlib import Path
from http.server import BaseHTTPRequestHandler

# Add parent directory to path to import schedule_tasks functions
sys.path.insert(0, str(Path(__file__).parent.parent))

from schedule_tasks import run_scheduler


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        """Handle GET requests (used by Vercel cron jobs)."""
        try:
            # Get API key from environment variable (set in Vercel dashboard)
            api_key = os.getenv("TODOIST_API_KEY")
            
            # Run the scheduler using the shared function
            result = run_scheduler(api_key=api_key)
            
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode("utf-8"))
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            response = {"error": str(e)}
            self.wfile.write(json.dumps(response).encode("utf-8"))

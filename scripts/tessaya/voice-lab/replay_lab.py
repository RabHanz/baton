"""Key release to text, through the real sidecar: each clip plays at real-time pace through
BATON_FAKE_MIC, the end of the file stands in for letting go of the key, and nothing is pasted.
  python replay_lab.py <exe> <model.gguf> <list.txt> <out.jsonl> [count]
Keep the laptop's own work running: the point is what he would feel.
"""
import json
import os
import shutil
import subprocess
import sys

exe, model, listing, out = sys.argv[1:5]
count = int(sys.argv[5]) if len(sys.argv) > 5 else 40
fake = os.path.join(os.path.dirname(out), "fake-mic.wav")
env = dict(os.environ, BATON_FAKE_MIC=fake)
clips = [line.strip() for line in open(listing, encoding="utf-8") if line.strip()][:count]

proc = subprocess.Popen([exe, "serve"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
                        encoding="utf-8", env=env, creationflags=getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0))


def send(message):
    proc.stdin.write(json.dumps(message) + "\n")
    proc.stdin.flush()


def wait(*names):
    for line in proc.stdout:
        event = json.loads(line)
        if event.get("ev") in names:
            return event
    raise SystemExit("sidecar ended")


wait("ready")
send({"cmd": "configure", "model": model, "paste": "ctrl_v", "language": "en", "cleanup": True})
wait("configured")
with open(out, "w", encoding="utf-8") as results:
    for index, clip in enumerate(clips):
        shutil.copyfile(clip, fake)
        send({"cmd": "toggle"})
        event = wait("text", "error", "idle")
        event["file"] = clip
        results.write(json.dumps(event) + "\n")
        results.flush()
send({"cmd": "quit"})

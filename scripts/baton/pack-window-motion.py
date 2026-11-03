#!/usr/bin/env python3
# Old path of scripts/tessaya/pack-window-motion.py; kept so existing callers keep working.
import os, sys
t = os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "tessaya", "pack-window-motion.py")
os.execv(sys.executable, [sys.executable, t, *sys.argv[1:]])

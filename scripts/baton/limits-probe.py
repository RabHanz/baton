#!/usr/bin/env python3
# Old path of scripts/tessaya/limits-probe.py; kept so existing callers keep working.
import os, sys
t = os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "tessaya", "limits-probe.py")
os.execv(sys.executable, [sys.executable, t, *sys.argv[1:]])

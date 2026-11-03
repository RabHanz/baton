"""Whispered speech for the dictation engine, with no microphone: his own clips and en-GB voices,
turned into whisper by replacing the voice with noise through the same vocal tract (LPC), over the
clip's own room tone, which a whisper does not lower. Scored against Wispr's text for his clips and
against the script for the en-GB voices. `make` then `score`; everything stays in the lab folder.
"""
import argparse
import asyncio
import json
import os
import subprocess
import wave

import numpy as np
from scipy.signal import lfilter

RATE = 16000
SCRIPT = [
    "Could you ask Sebastian to run the merge queue on Sonnet again tomorrow morning?",
    "The third test failed because the worktree was on the wrong branch, so rebase it first.",
    "Send the invoice for four hundred and twenty pounds to the Margin account before Friday.",
    "I think the sidecar should stop listening after ten seconds if nothing is said.",
    "Please open the pull request, but do not merge it until the critic has read the diff.",
    "We measured nine hundred milliseconds on the laptop, which is still too slow for me.",
    "Tell Freya the deploy broke because the pnpm lockfile was out of date.",
    "Remember to book the train to Manchester for half past seven on Tuesday.",
    "The clean-up layer must keep every number and every name exactly as I said them.",
    "Move the Parakeet model onto the D drive and check the hash after it lands.",
]
VOICES = ["en-GB-SoniaNeural", "en-GB-RyanNeural", "en-GB-LibbyNeural", "en-GB-MaisieNeural", "en-GB-ThomasNeural"]


def read(path):
    with wave.open(path, "rb") as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768


def write(path, pcm):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(np.clip(pcm * 32768, -32768, 32767).astype(np.int16).tobytes())


def frames_rms(pcm, size=320):
    usable = len(pcm) // size * size
    if usable == 0:
        return np.array([1e-9])
    return np.sqrt(np.mean(pcm[:usable].reshape(-1, size) ** 2, axis=1)) + 1e-9


def speech_db(pcm):
    rms = frames_rms(pcm)
    return 20 * np.log10(np.percentile(rms, 90))


def room_tone(pcm, seconds):
    """The quietest stretch of the clip, tiled: what the room sounds like when he says nothing."""
    size = 1600
    rms = frames_rms(pcm, size)
    order = np.argsort(rms)[: max(3, len(rms) // 10)]
    tone = np.concatenate([pcm[i * size : (i + 1) * size] for i in order])
    return np.resize(tone - tone.mean(), int(seconds * RATE))


def lpc(frame, order=18):
    r = np.correlate(frame, frame, "full")[len(frame) - 1 : len(frame) + order]
    if r[0] < 1e-12:
        return np.r_[1.0, np.zeros(order)]
    a = np.r_[1.0, np.zeros(order)]
    e = r[0]
    for i in range(1, order + 1):
        k = -(r[i] + a[1:i] @ r[i - 1 : 0 : -1]) / e
        a[: i + 1] = a[: i + 1] + k * a[: i + 1][::-1]
        e *= 1 - k * k
    return a


def whisperise(pcm, seed):
    """Keeps the vocal tract, frame by frame, and throws the voice away."""
    rng = np.random.default_rng(seed)
    size, hop = 400, 200
    window = np.hanning(size)
    out = np.zeros(len(pcm) + size)
    for start in range(0, len(pcm) - size, hop):
        frame = pcm[start : start + size] * window
        gain = np.sqrt(np.mean(frame**2))
        if gain < 1e-7:
            continue
        shaped = lfilter([1.0], lpc(frame), rng.standard_normal(size))
        shaped *= gain / (np.sqrt(np.mean(shaped**2)) + 1e-12)
        out[start : start + size] += shaped * window
    # Sibilant and breath energy stays; the chest does not.
    return lfilter([1, -0.9], [1], out[: len(pcm)])


def scaled(pcm, db):
    return pcm * 10 ** ((db - speech_db(pcm)) / 20)


async def voices(folder):
    import edge_tts

    os.makedirs(folder, exist_ok=True)
    for v, voice in enumerate(VOICES):
        for s, line in enumerate(SCRIPT):
            mp3 = os.path.join(folder, f"{v}-{s}.mp3")
            await edge_tts.Communicate(line, voice).save(mp3)
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", mp3, "-ar", "16000", "-ac", "1",
                            "-c:a", "pcm_s16le", mp3[:-4] + ".wav"], check=True)
            os.remove(mp3)


def make(args):
    root = os.path.join(args.lab, "whisper")
    clips = [json.loads(l) for l in open(os.path.join(args.lab, "clips.jsonl"), encoding="utf-8")]
    clips = [c for c in clips if c["mic"] == "AT2020" and 5 <= c["duration"] <= 15 and c["asr"]]
    levels = []
    for clip in clips:
        pcm = read(clip["file"])
        levels.append((speech_db(pcm), clip))
    levels.sort(key=lambda x: x[0])
    picked = [c for _, c in levels[:: max(1, len(levels) // args.clips)]][: args.clips]
    print("speech level dBFS: quietest %.1f, median %.1f, loudest %.1f" % (
        levels[0][0], levels[len(levels) // 2][0], levels[-1][0]))
    manifest = []
    for clip in picked:
        pcm = read(clip["file"])
        name = clip["id"] + ".wav"
        room = room_tone(pcm, len(pcm) / RATE)
        manifest.append({"name": name, "ref": clip["asr"]})
        write(os.path.join(root, "normal", name), pcm)
        for db in (20, 30, 40):
            write(os.path.join(root, f"att{db}", name), pcm * 10 ** (-db / 20))
        soft = whisperise(pcm, 1)
        for level in (-35, -45):
            write(os.path.join(root, f"whisper{-level}", name), scaled(soft, level) + room)
    # The quietest real ones he actually dictated, untouched: the only true low-level speech here.
    for db, clip in levels[:30]:
        name = clip["id"] + ".wav"
        write(os.path.join(root, "quietest", name), read(clip["file"]))
        manifest.append({"name": name, "ref": clip["asr"]})
    gb = os.path.join(root, "gb-src")
    if not os.path.isdir(gb):
        asyncio.run(voices(gb))
    for v in range(len(VOICES)):
        for s, line in enumerate(SCRIPT):
            name = f"gb{v}-{s}.wav"
            pcm = read(os.path.join(gb, f"{v}-{s}.wav"))
            room = room_tone(read(picked[s]["file"]), len(pcm) / RATE)
            write(os.path.join(root, "gbclear", name), scaled(pcm, -20) + room)
            soft = whisperise(pcm, v * 100 + s)
            write(os.path.join(root, "gbwhisper", name), scaled(soft, -40) + room)
            manifest.append({"name": name, "ref": line})
    with open(os.path.join(root, "manifest.json"), "w", encoding="utf-8") as out:
        json.dump(manifest, out)
    for folder in sorted(os.listdir(root)):
        path = os.path.join(root, folder)
        if os.path.isdir(path) and folder != "gb-src":
            with open(os.path.join(root, f"{folder}.txt"), "w", encoding="utf-8") as listing:
                listing.write("\n".join(os.path.join(path, f) for f in sorted(os.listdir(path))) + "\n")
    print("made", len(picked), "clips")


def score(args):
    import re

    root = os.path.join(args.lab, "whisper")
    refs = {m["name"]: m["ref"] for m in json.load(open(os.path.join(root, "manifest.json"), encoding="utf-8"))}
    words = lambda t: re.findall(r"[a-z0-9']+", t.lower())

    def distance(a, b):
        row = list(range(len(b) + 1))
        for i, x in enumerate(a, 1):
            prev, row[0] = row[0], i
            for j, y in enumerate(b, 1):
                prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (x != y))
        return row[-1]

    for path in sorted(p for p in os.listdir(args.results) if p.endswith(".jsonl")):
        edits = count = empty = 0
        for line in open(os.path.join(args.results, path), encoding="utf-8"):
            row = json.loads(line)
            if "text" not in row:
                continue
            ref = words(refs[os.path.basename(row["file"])])
            hyp = words(row["text"])
            edits += distance(ref, hyp)
            count += len(ref)
            empty += not hyp
        if count:
            print(f"{path[:-6]:32} WER {edits / count:6.1%}  words {count:5d}  empty clips {empty}")


parser = argparse.ArgumentParser()
parser.add_argument("step", choices=["make", "score"])
parser.add_argument("--lab", default=r"D:\baton-voice-lab")
parser.add_argument("--clips", type=int, default=60)
parser.add_argument("--results", default=r"D:\baton-voice-lab\whisper\results")
args = parser.parse_args()
{"make": make, "score": score}[args.step](args)

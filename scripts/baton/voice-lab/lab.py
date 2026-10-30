"""Voice lab analysis, standard library only. Nothing here leaves the laptop.

  lab.py export  --lab DIR [--sample 240]   Wispr's stored clips to DIR\\clips, read-only
  lab.py dictation --lab DIR                Parakeet against Wispr on those clips
  lab.py report  --lab DIR                  false wakes and misses against the targets
"""
import argparse
import collections
import json
import os
import random
import re
import sqlite3
import statistics
import sys

MICS = [("AT2020", "scarlett|focusrite"), ("DJI", "wireless mic rx|dji")]
TARGET_FA = 0.5
TARGET_MISS = 0.05


def mic_of(name):
    for label, pattern in MICS:
        if re.search(pattern, name or "", re.I):
            return label
    return "other"


def words(text):
    text = (text or "").lower().replace("’", "'")
    return re.findall(r"[\w']+", text)


def edit_distance(a, b):
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        previous, row[0] = row[0], i
        for j, y in enumerate(b, 1):
            previous, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, previous + (x != y))
    return row[-1]


def wer(reference, hypothesis):
    return edit_distance(reference, hypothesis) / max(1, len(reference))


def rows_of(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def export(args):
    source = os.path.expandvars(r"%APPDATA%\Wispr Flow\flow.sqlite")
    db = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    db.text_factory = lambda b: b.decode("utf-8", "replace")
    rows = db.execute(
        "select transcriptEntityId, micDevice, app, duration, asrText, formattedText, editedText, "
        "pastedText from History where length(audio) > 0 and duration >= 1 and status = 'formatted'"
    ).fetchall()
    random.seed(45)
    random.shuffle(rows)
    per_mic = collections.defaultdict(list)
    for row in rows:
        per_mic[mic_of(row[1])].append(row)
    # Every DJI clip there is, then the AT2020, then the rest.
    wanted = args.sample
    chosen = per_mic["DJI"][: wanted // 4]
    chosen += per_mic["AT2020"][: wanted - len(chosen) - wanted // 10]
    chosen += per_mic["other"][: wanted // 10]
    clips = os.path.join(args.lab, "clips")
    os.makedirs(clips, exist_ok=True)
    with open(os.path.join(args.lab, "clips.jsonl"), "w", encoding="utf-8") as out, open(
        os.path.join(args.lab, "clips.txt"), "w", encoding="utf-8"
    ) as listing:
        for row in chosen:
            clip_id = row[0]
            path = os.path.join(clips, f"{clip_id}.wav")
            audio = db.execute("select audio from History where transcriptEntityId = ?", (clip_id,)).fetchone()[0]
            with open(path, "wb") as handle:
                handle.write(audio)
            out.write(json.dumps({
                "id": clip_id, "mic": mic_of(row[1]), "app": row[2], "duration": row[3], "asr": row[4],
                "formatted": row[5], "edited": row[6], "pasted": row[7], "file": path,
            }) + "\n")
            listing.write(path + "\n")
    print("exported", collections.Counter(mic_of(r[1]) for r in chosen), "of", {k: len(v) for k, v in per_mic.items()})


def dictation(args):
    clips = {row["file"]: row for row in rows_of(os.path.join(args.lab, "clips.jsonl"))}
    results = [r for r in rows_of(os.path.join(args.lab, "parakeet.jsonl")) if r.get("file") in clips]
    table = collections.defaultdict(list)
    for result in results:
        if "text" not in result:
            continue
        clip = clips[result["file"]]
        ours, raw, formatted = words(result["text"]), words(clip["asr"]), words(clip["formatted"])
        edited = words(clip["edited"]) if clip["edited"] else None
        table[clip["mic"]].append({
            "vs_raw": wer(raw, ours),
            "vs_formatted": wer(formatted, ours),
            "wispr_vs_formatted": wer(formatted, raw),
            "corrected": edited is not None and edited != formatted,
            "ours_vs_edit": wer(edited, ours) if edited else None,
            "wispr_vs_edit": wer(edited, formatted) if edited else None,
            "rtf": result["inferMs"] / max(1, result["audioMs"]),
            "words": len(raw),
            "seconds": result["audioMs"] / 1000,
            "infer": result["inferMs"] / 1000,
        })
    print("Agreement with Wispr is not accuracy: both are machines, and Wispr also rewrites.\n")
    print(f"{'mic':8} {'clips':>5} {'audio min':>9} {'vs Wispr raw':>13} {'vs Wispr final':>15} {'speed':>7} {'p95 s':>6}")
    everything = []
    for mic, items in sorted(table.items()):
        everything += items
        seconds = sum(i["seconds"] for i in items)
        count = sum(i["words"] for i in items) or 1
        weighted = lambda key: sum(i[key] * i["words"] for i in items) / count
        latency = sorted(i["infer"] for i in items)
        print(f"{mic:8} {len(items):5d} {seconds / 60:9.1f} {weighted('vs_raw'):12.1%} {weighted('vs_formatted'):14.1%} "
              f"{seconds / max(0.001, sum(latency)):6.1f}x {latency[int(len(latency) * 0.95)]:6.1f}")
    corrected = [i for i in everything if i["corrected"]]
    if corrected:
        ours = statistics.mean(i["ours_vs_edit"] for i in corrected)
        theirs = statistics.mean(i["wispr_vs_edit"] for i in corrected)
        print(f"\nClips he edited afterwards ({len(corrected)}): Parakeet WER {ours:.1%}, Wispr final WER {theirs:.1%}.")
        print("Biased to Wispr: the edit started from Wispr's own text.")
    # The ones worth a human ear: where the two differ most, for a gold set.
    scored = []
    for result in results:
        if "text" in result:
            clip = clips[result["file"]]
            scored.append((wer(words(clip["asr"]), words(result["text"])), result["file"], clip["asr"], result["text"]))
    scored.sort(reverse=True)
    with open(os.path.join(args.lab, "disagreements.txt"), "w", encoding="utf-8") as out:
        for score, file, theirs, ours in scored[:40]:
            out.write(f"{score:.0%}  {file}\n  Wispr:    {theirs}\n  Parakeet: {ours}\n\n")
    print("\nThe 40 biggest disagreements are in disagreements.txt. Nothing was sent anywhere.")


def report(args):
    thresholds = ["0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "0.95"]
    clips = {row["file"]: row for row in rows_of(os.path.join(args.lab, "clips.jsonl"))}
    false = collections.defaultdict(lambda: collections.Counter())
    hours = collections.Counter()
    # His stored dictation: real speech on his mics, excluding clips that say the word.
    for row in rows_of(os.path.join(args.lab, "replay.jsonl")):
        clip = clips.get(row["file"])
        if clip is None:
            continue
        said = " ".join(words(clip["asr"]))
        hours[(clip["mic"], "dictation")] += row["seconds"] / 3600
        for word, data in row["words"].items():
            if word in said:
                continue
            for t in thresholds:
                false[(clip["mic"], word, "dictation")][t] += data["events"].get(t, 0)
    # Ambient runs: the room, for hours.
    for row in rows_of(os.path.join(args.lab, "ambient.jsonl")):
        hours[(row["label"], "ambient")] += row["seconds"] / 3600
        for word, data in row["words"].items():
            for t in thresholds:
                false[(row["label"], word, "ambient")][t] += data["events"].get(t, 0)
    # Spoken samples: one prompt per 3 s window.
    misses = {}
    for row in rows_of(os.path.join(args.lab, "samples.jsonl")):
        name = os.path.basename(row["file"])
        match = re.match(r"(\w+?)-(\w+?)-\d+\.wav", name)
        if not match:
            continue
        mic, word = match.groups()
        data = row["words"].get(word)
        entry = misses.setdefault((mic, word), collections.Counter())
        entry["n"] += 1
        for t in thresholds:
            entry[t] += int(data["peak"] < float(t))
    words_seen = sorted({key[1] for key in false} | {key[1] for key in misses})
    mics = sorted({key[0] for key in false} | {key[0] for key in misses})
    print(f"Targets: under {TARGET_FA} false wakes an hour, under {TARGET_MISS:.0%} misses. '-' means not measured.\n")
    verdicts = {}
    for mic in mics:
        for word in words_seen:
            print(f"{word} on {mic}")
            print(f"  {'threshold':>9} {'false/h dictation':>18} {'false/h ambient':>16} {'miss':>6}")
            for t in thresholds:
                cells = {}
                for kind in ("dictation", "ambient"):
                    length = hours[(mic, kind)]
                    cells[kind] = false[(mic, word, kind)][t] / length if length > 0 else None
                entry = misses.get((mic, word))
                miss = entry[t] / entry["n"] if entry else None
                show = lambda v, f: "-" if v is None else format(v, f)
                print(f"  {t:>9} {show(cells['dictation'], '18.2f'):>18} {show(cells['ambient'], '16.2f'):>16} {show(miss, '6.1%'):>6}")
                measured = [v for v in cells.values() if v is not None]
                if measured and miss is not None and max(measured) < TARGET_FA and miss < TARGET_MISS:
                    verdicts.setdefault((mic, word), t)
            length = hours[(mic, "ambient")]
            print(f"  hours: dictation {hours[(mic, 'dictation')]:.2f}, ambient {length:.2f}; "
                  f"spoken samples {misses.get((mic, word), {}).get('n', 0)}")
            pick = verdicts.get((mic, word))
            print("  " + (f"MET at threshold {pick}" if pick else "NOT MET on what was measured") + "\n")
    if hours and any(k[1] == "ambient" for k in hours) and sum(v for k, v in hours.items() if k[1] == "ambient") < 4:
        print("Under 4 ambient hours: a zero here says little about 0.5 an hour.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["export", "dictation", "report"])
    parser.add_argument("--lab", default=r"D:\baton-voice-lab")
    parser.add_argument("--sample", type=int, default=240)
    args = parser.parse_args()
    {"export": export, "dictation": dictation, "report": report}[args.command](args)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()

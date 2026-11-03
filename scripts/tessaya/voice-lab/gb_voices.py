"""Held-out British test voices as 16 kHz WAVs: Microsoft neural en-GB via edge-tts."""
import asyncio
import os
import subprocess
import sys

import edge_tts

OUT = sys.argv[1]
VOICES = ["en-GB-SoniaNeural", "en-GB-RyanNeural", "en-GB-LibbyNeural", "en-GB-MaisieNeural", "en-GB-ThomasNeural"]
WORDS = {"sebastian": "Sebastian", "alfred": "Alfred", "freya": "Freya", "onyx": "Onyx"}
RATES = ["-15%", "+0%", "+15%"]
FORMS = ["{}.", "{}, are you there?"]


async def main():
    os.makedirs(OUT, exist_ok=True)
    for voice in VOICES:
        for word, text in WORDS.items():
            for r, rate in enumerate(RATES):
                for f, form in enumerate(FORMS):
                    mp3 = f"{OUT}/{voice}-{word}-{r}{f}.mp3"
                    await edge_tts.Communicate(form.format(text), voice, rate=rate).save(mp3)
                    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-t", "0.6", "-i",
                                    "anullsrc=r=16000:cl=mono", "-i", mp3, "-filter_complex",
                                    "[1:a]aresample=16000,aformat=channel_layouts=mono[a];[0:a][a]concat=n=2:v=0:a=1",
                                    "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", mp3[:-4] + ".wav"], check=True)
                    os.remove(mp3)


asyncio.run(main())

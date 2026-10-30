"""The trainer, with CMU pronunciations for the names it does not know.

Its fallback phonemizer model is a dead S3 link now, so a word outside CMUdict stops the run.
"""
import runpy

import pronouncing

pronouncing.init_cmu()
for word, phones in {"freya": "F R EY1 AH0", "sebastian": "S AH0 B AE1 S CH AH0 N", "alfred": "AE1 L F R AH0 D"}.items():
    if word not in pronouncing.lookup:
        pronouncing.lookup[word] = [phones]
        pronouncing.pronunciations.append((word, phones))

runpy.run_module("openwakeword.train", run_name="__main__", alter_sys=True)

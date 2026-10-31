"""The openWakeWord training config for one word. No "hey": the word alone is the phrase."""
import sys

import yaml

WORDS = {
    "onyx": {
        # ON-iks. He owns the name Onnyx, so it can come up when he is not addressing Baton.
        "target": ["onyx"],
        "negative": ["on it", "on x", "honest", "on the", "unix", "phoenix", "onions", "only",
                     "tonics", "antics", "on its", "and it's"],
    },
    "sebastian": {
        "target": ["sebastian"],
        # espeak only says se-BAS-chun, which the en-GB test voices do not (2 of 30 fired). His own
        # two real uses fired on a model trained that way, so both endings go in, as phonemes.
        "ipa": ["səbˈastiən", "sɪbˈastiən", "səbˈɑːstiən", "səbˈæstiən",
                "səbˈastʃən", "sɪbˈastʃən", "səbˈɑːstʃən", "səbˈæstʃən"],
        # Things he says all day that sound close, on top of the trainer's phonetic negatives.
        "negative": ["celebration", "suggestion", "the bastion", "sebastopol", "save a station",
                     "session", "the question", "a bastion", "see baton"],
    },
    "alfred": {
        "target": ["alfred"],
        "negative": ["offered", "afraid", "altered", "alford", "all for it", "out for", "affront",
                     "albert", "alfa", "after", "oxford", "hold red", "welfare"],
    },
    "freya": {
        # He says FRAY-uh. espeak reads "freya" that way in both en-us and en-gb.
        "target": ["freya", "fray uh"],
        "negative": ["free uh", "fire", "prayer", "freer", "for you", "fraying", "frame", "afraid", "friend",
                     "player", "free", "freight", "friday", "fair", "pray", "fray", "free up"],
    },
}

if __name__ == "__main__":
    word, n_samples, steps = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    print(yaml.safe_dump({
        "model_name": word,
        "target_phrase": WORDS[word]["target"],
        "custom_negative_phrases": WORDS[word]["negative"],
        "n_samples": n_samples,
        "n_samples_val": max(500, n_samples // 10),
        "tts_batch_size": 25,
        "augmentation_batch_size": 16,
        "piper_sample_generator_path": "./piper-sample-generator",
        "output_dir": "./model",
        "rir_paths": ["./mit_rirs"],
        "background_paths": ["./background"],
        "background_paths_duplication_rate": [1],
        "false_positive_validation_data_path": "./validation_set_features.npy",
        "augmentation_rounds": 1,
        "feature_data_files": {"ACAV100M_sample": "./openwakeword_features_ACAV100M_2000_hrs_16bit.npy"},
        "batch_n_per_class": {"ACAV100M_sample": 1024, "adversarial_negative": 70, "positive": 70},
        "model_type": "dnn",
        "layer_size": 64,
        "steps": steps,
        "max_negative_weight": 3000,
        "target_false_positives_per_hour": 0.2,
    }))

//! Transcribing while he speaks. Neither Parakeet TDT build streams (transcribe.cpp offers that only
//! to the cache-aware models), so this is Handy's live chunking with shorter chunks: cut at pauses,
//! decode each piece as it arrives, and at key release only the last piece is left. Handy cuts for
//! accuracy at 30 s; these are cut for latency. Pieces do not overlap: carrying audio across a cut
//! to give the model context cost more words at the seam than it saved (D103).

const RATE: usize = 16_000;
const FRAME: usize = RATE / 50;
const PAUSE_FRAMES: usize = 10;

#[derive(Clone, Copy)]
pub struct ChunkParams {
    pub min_samples: usize,
    pub max_samples: usize,
}

impl ChunkParams {
    /// BATON_CHUNK=min_ms,max_ms is for measuring, like BATON_THREADS.
    pub fn from_env() -> Self {
        let mut ms = [4_000, 10_000];
        if let Ok(text) = std::env::var("BATON_CHUNK") {
            for (slot, value) in ms.iter_mut().zip(text.split(',')) {
                *slot = value.trim().parse().unwrap_or(*slot);
            }
        }
        let samples = |ms: usize| ms * RATE / 1000;
        Self { min_samples: samples(ms[0]), max_samples: samples(ms[1]) }
    }
}

fn frame_levels(pcm: &[f32]) -> Vec<f32> {
    pcm.chunks_exact(FRAME)
        .map(|f| (f.iter().map(|s| s * s).sum::<f32>() / FRAME as f32).sqrt())
        .collect()
}

fn percentile(values: &[f32], at: f32) -> f32 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f32::total_cmp);
    sorted.get(((sorted.len() as f32 * at) as usize).min(sorted.len().saturating_sub(1))).copied().unwrap_or(0.0)
}

/// The middle of the last pause in `pcm`. Relative to this audio's own floor and speech, so a
/// whisper pauses as clearly as a shout.
fn last_pause(pcm: &[f32], from: usize) -> Option<usize> {
    let levels = frame_levels(pcm);
    let (floor, loud) = (percentile(&levels, 0.1), percentile(&levels, 0.9));
    if loud < floor * 2.0 {
        return None;
    }
    let quiet = floor + (loud - floor) * 0.1;
    let mut run = 0;
    for (i, level) in levels.iter().enumerate().rev() {
        if *level <= quiet {
            run += 1;
        } else {
            run = 0;
        }
        if run >= PAUSE_FRAMES {
            // Extend to the start of this quiet stretch, then take its middle.
            let start = levels[..i].iter().rposition(|l| *l > quiet).map_or(0, |p| p + 1);
            let cut = (start + i + run) / 2 * FRAME;
            return (cut >= from).then_some(cut);
        }
    }
    None
}

/// With no pause at all: the quietest moment of the last 1.5 s, the least bad place to split a word.
fn quietest(pcm: &[f32]) -> usize {
    let from = pcm.len().saturating_sub(RATE * 3 / 2);
    let levels = frame_levels(&pcm[from..]);
    let best = levels.iter().enumerate().min_by(|a, b| a.1.total_cmp(b.1)).map_or(0, |(i, _)| i);
    from + best * FRAME
}

pub struct Chunker {
    params: ChunkParams,
    pending: Vec<f32>,
    scanned_at: usize,
}

impl Chunker {
    pub fn new(params: ChunkParams) -> Self {
        Self { params, pending: Vec::new(), scanned_at: 0 }
    }

    fn cut(&mut self, at: usize) -> Vec<f32> {
        self.scanned_at = 0;
        self.pending.drain(..at).collect()
    }

    /// Takes audio; returns a piece when a pause, or the length limit, makes one certain.
    pub fn push(&mut self, pcm: &[f32]) -> Option<Vec<f32>> {
        self.pending.extend_from_slice(pcm);
        if self.pending.len() < self.params.min_samples || self.pending.len() < self.scanned_at + RATE / 5 {
            return None;
        }
        self.scanned_at = self.pending.len();
        if let Some(at) = last_pause(&self.pending, self.params.min_samples) {
            return Some(self.cut(at));
        }
        if self.pending.len() >= self.params.max_samples {
            let at = quietest(&self.pending);
            return Some(self.cut(at));
        }
        None
    }

    /// What is left at key release.
    pub fn finish(&mut self) -> Option<Vec<f32>> {
        if self.pending.is_empty() {
            return None;
        }
        let at = self.pending.len();
        Some(self.cut(at))
    }
}

const TARGET_LEVEL: f32 = 0.07; // about -23 dBFS at the loud end of speech
const MAX_GAIN: f32 = 100.0; // 40 dB
const SILENCE: f32 = 2e-5; // under 1 LSB of 16-bit audio

/// Brings quiet speech up to what the model trained on. Never turns speech down, and leaves
/// digital silence alone so it does not become amplified hiss.
pub fn lift_gain(pcm: &mut [f32]) -> f32 {
    let levels = frame_levels(pcm);
    let loud = percentile(&levels, 0.95);
    if loud < SILENCE {
        return 1.0;
    }
    let gain = (TARGET_LEVEL / loud).clamp(1.0, MAX_GAIN);
    if gain > 1.0 {
        for sample in pcm.iter_mut() {
            *sample = (*sample * gain).clamp(-1.0, 1.0);
        }
    }
    gain
}

#[cfg(test)]
mod tests {
    use super::*;

    const PARAMS: ChunkParams =
        ChunkParams { min_samples: 2 * RATE, max_samples: 6 * RATE };

    fn tone(seconds: f32, level: f32) -> Vec<f32> {
        (0..(seconds * RATE as f32) as usize).map(|i| (i as f32 * 0.3).sin() * level).collect()
    }

    fn speech_with_gap(level: f32) -> Vec<f32> {
        let mut pcm = tone(3.0, level);
        pcm.extend(tone(0.4, level / 300.0));
        pcm.extend(tone(1.0, level));
        pcm
    }

    fn pieces(chunker: &mut Chunker, pcm: &[f32]) -> Vec<Vec<f32>> {
        let mut out: Vec<Vec<f32>> = pcm.chunks(480).filter_map(|c| chunker.push(c)).collect();
        out.extend(chunker.finish());
        out
    }

    #[test]
    fn cuts_at_a_pause_at_any_loudness() {
        for level in [0.3, 0.003] {
            let pcm = speech_with_gap(level);
            let got = pieces(&mut Chunker::new(PARAMS), &pcm);
            assert_eq!(got.len(), 2, "level {level}");
            let cut = got[0].len();
            assert!((3 * RATE..3 * RATE + 7 * RATE / 20).contains(&cut), "cut at {cut}");
        }
    }

    #[test]
    fn no_audio_is_lost_or_repeated() {
        let pcm = speech_with_gap(0.2);
        let got = pieces(&mut Chunker::new(PARAMS), &pcm);
        assert_eq!(got.concat(), pcm);
    }

    #[test]
    fn unbroken_speech_stops_at_the_limit() {
        let got = pieces(&mut Chunker::new(PARAMS), &tone(7.0, 0.2));
        assert!(got.len() >= 2);
        assert!(got.iter().all(|p| p.len() <= 6 * RATE + RATE / 2));
    }

    #[test]
    fn gain_lifts_a_whisper_and_leaves_the_rest() {
        let mut quiet = tone(1.0, 0.001);
        let gain = lift_gain(&mut quiet);
        assert!(gain > 40.0);
        assert!(quiet.iter().cloned().fold(0.0, f32::max) > 0.05);
        let mut loud = tone(1.0, 0.5);
        assert_eq!(lift_gain(&mut loud), 1.0);
        let mut silent = vec![0.0; RATE];
        assert_eq!(lift_gain(&mut silent), 1.0);
    }
}

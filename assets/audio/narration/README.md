# Simulator narration

Bundled synthetic speech clips generated locally with Kokoro 0.9.4, Kokoro-82M v1.0, stock British English voice `bf_emma`, speed 1.0. The callsign is **Sentry One PTZ**; generation spells PTZ as separate letters for pronunciation.

Engine: https://github.com/hexgrad/kokoro (Apache-2.0; see KOKORO-LICENSE.txt).
Model and stock voice: https://huggingface.co/hexgrad/Kokoro-82M (Apache-2.0).
Pinned revision: `f3ff3571791e39611d31c381e3a41a3af07b4987`.
The upstream model card includes its training-data acknowledgements.

This repository contains generated audio and original dialogue, not model weights or the inference engine. Preserve this provenance when copying the voice setup. Other simulator assets retain their existing licensing.

## Regeneration

Use a Python 3.12 virtual environment with system packages `espeak-ng` and `ffmpeg` installed:

```sh
pip install -r scripts/requirements-voice.txt
python scripts/generate_narration.py
```

First use downloads the model, stock voice, and English language dependencies. Use `--offline` once those are cached. Inference runs locally on CPU, with no paid API. The manifest records spoken dialogue, durations, and hashes.

The browser decodes clips after user interaction. Messages are queued with a pause between announcements; unavailable audio leaves the on-screen message visible. New dialogue requires regeneration. Spoken dialogue uses conversational wording while on-screen text stays concise.

Store the script, manifest, and MP3s in GitHub. Download weights from upstream during development. GitHub Pages serves the audio; it does not run Python inference.

Clock alerts: twelve vehicle-relative directions use the same bundled Kokoro voice. Each contact clip records its own slowdown cue in `slowdown_seconds`, preserving the pause before and after “Slow down.” No runtime speech service is required.

Air-contact lines use the same voice. Regenerate only these with `--offline --only-prefix air_`; the existing manifest and patrol MP3s are retained.

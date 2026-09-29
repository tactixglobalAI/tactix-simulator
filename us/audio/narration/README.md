# US American female narration

Generated locally with Kokoro 0.9.4 / Kokoro-82M `af_heart` American female voice. See ../../../assets/audio/narration/README.md and KOKORO-LICENSE.txt there for provenance. All 41 narration keys have US voice overrides; original Bolero audio and manifest are unchanged.

Person alerts give one vehicle-relative direction (ahead, ahead on the right, on the right, etc.), with no clock-position duplication and no range. Air-contact cues use the same bearing calculation. A 0.8-second pause precedes “Slow down” and a one-second pause follows it; each clip records the slowdown timing. The touchscreen direction updates as the vehicle moves; the initial spoken cue describes acquisition time.

Regenerate with the existing voice environment:
`python scripts/generate_us_narration.py --offline`
No speech model runs in the browser. Generated MP3s and their SHA-256 manifest are shipped with the static site.

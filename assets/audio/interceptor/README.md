# Interceptor launch reference audio

`launch-first-10s.mp3` contains only source time **00:00.000–00:10.000** from the user-provided `PrototypeV1InterceptorLaunch.mp4`. The user explicitly requested this extraction and incorporation into the simulator. No additional reuse license is asserted.

- Original: 30 fps video, 44.1 kHz stereo AAC audio.
- Export: 44.1 kHz stereo MP3, 96 kbit/s, 120,730 bytes.
- Processing: silence source 0–2.55 seconds (pre-rotor background); fade in over 2.55–2.70 seconds; gentle 80 Hz high-pass reduces low rumble; fade out over 9.75–10 seconds. No time stretching, looping, gain normalization, or synthesized rotor sound.
- Original first-ten-second levels: mean −24.6 dBFS; peak −1.3 dBFS. Original takeoff dynamics are preserved.
- MP3 container reports 10.031020 seconds because of encoder padding. Playback is capped at ten seconds and stops when the launch scenario ends (about 9.967 seconds).
- Timing: playback starts at launch authorization together with reference frame zero. The reference's lift near 4.6 seconds remains at that position in the sound. Browser late decoding seeks to the elapsed launch time instead of restarting the sound late.
- Hidden-tab pause/resume and repeat launch stop the previous source, preventing overlapping playback.

Local, already-installed faster-whisper large-v3-turbo analysis of only the first ten seconds detected one possible short utterance at 0–0.38 seconds (word confidence 0.120, too low to assert exact wording). It produced no later speech transcript. The entire pre-rotor interval is now silent, including that possible utterance. Absence of a transcript does not establish absence of every background voice.

The spectrogram shows rising rotor harmonics clearly emerging around 2.65 seconds and strengthening through liftoff. The 2.55-second cut and 150 ms fade preserve this onset; the visual rotor startup is adjusted to that evidence instead of the earlier 3.5-second estimate. Lift translation remains at about 4.6 seconds.

This is cleaned field audio, not an isolated studio rotor stem: environmental sound overlapping the retained takeoff may remain. No claim of complete source separation or removal of overlapping speech is made. Audible speaker/headphone review remains useful; codec decoding and playback timing can be tested automatically.

Source SHA-256: `adf8db46eaeb9e757ead9fe4ff39294a122072285a73371058a4c5b68d4535be`

MP3 SHA-256: `6952d37a45826c2ad4e026c944d2d976cf4298f4f98b1097644f195b4309bdf0`

Reproduce with existing ffmpeg:

```sh
ffmpeg -i /home/praj/Downloads/PrototypeV1InterceptorLaunch.mp4 \
  -map 0:a:0 -t 10 -vn \
  -af "highpass=f=80,volume=0:enable='lt(t,2.55)',afade=t=in:st=2.55:d=0.15,afade=t=out:st=9.75:d=0.25" \
  -c:a libmp3lame -b:a 96k -ar 44100 -map_metadata -1 \
  assets/audio/interceptor/launch-first-10s.mp3
```

Validation: ffprobe verified MP3/stereo/44.1 kHz and size; full ffmpeg decode completed without errors. Standalone controller lifecycle checks covered a delayed decode starting at the correct 1.2-second offset, paused timeline continuity, replay without overlap, and stopping.

After cleanup, full decode passed and ffmpeg silence detection measured silence from 0 through 2.56224 seconds at −60 dBFS (including the start of the fade). The ten-second timeline remains intact.

## Extended sky demonstration

`launch-sky-demo.mp3` retains the cleaned lead-in through9.2s and crossfades four copies of the same source's8.2–9.4s rotor segment, fading out by12.95s. No material beyond the reference's first10s is used. Total encoded duration is about13.4s; playback stops at scenario completion. Rebuild with the existing voice Python environment and `scripts/extend_launch_audio.py` (numpy and ffmpeg). The original cleaned10second clip remains unchanged.

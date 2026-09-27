# TactixGlobal patrol simulator

Public browser build: https://tactixglobalai.github.io/tactix-simulator/

Open the site, enter the vehicle, and begin patrol on the dashboard touchscreen. Mouse and touch are supported. TOUCHSCREEN opens enlarged controls; EXTERIOR VIEW shows the driver, rolling wheels and PTZ.

The officer patrols at 18 km/h and responds to “Slow down” by gradually reducing to 5 km/h. Detected activity is tracked and recorded locally. SEND CLIP runs a simulated 3.5-second transmission followed by a timestamped confirmation; no real command-center backend is connected. SAVE CLIP downloads the recording. Clips are otherwise held only in browser memory.

Voice playback uses bundled Kokoro-generated MP3s. Three.js, GLTFLoader and all models are included; no Python, model weights, API key or cloud inference is needed at runtime.

Initial runtime assets are approximately 85 MB. Phone performance tuning and real-device profiling are pending. Use a modern WebGL browser; recording support varies by browser. Touch layouts are tested in a desktop browser at narrow portrait and landscape sizes, not on physical phones.

See THIRD_PARTY_NOTICES.md for provenance. This is a runtime-only distribution; original authoring sources remain private. It is not a blanket license to reuse the assets.

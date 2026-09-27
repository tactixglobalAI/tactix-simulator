# Dependency and asset provenance

This project contains mixed-license assets. No blanket open-source license or public redistribution grant is asserted for the repository.

| Component | Source / permission | Included records |
|---|---|---|
| Three.js 0.128.0 and GLTFLoader | three npm distribution, MIT | vendor/three-0.128.0/LICENSE |
| Kokoro narration | Apache-2.0 engine and Kokoro-82M model; stock bf_emma voice | assets/audio/narration/README.md and KOKORO-LICENSE.txt |
| Bolero vehicle | Downloaded source; owner states licensed; exact redistribution terms not supplied | README.md; assets/source/bolero_camper |
| Tactical officer | Owner-supplied licensed asset; exact redistribution terms not supplied | README.md; assets/source/tactical_officer |
| Hooded male | Owner rechecked and confirmed permission for this public simulator deployment on 2026-09-26; creator/download URL and license text not supplied | assets/source/hooded_male/README.md |
| Touchscreen enclosure | Project-authored mechanical geometry based on user-supplied Gemini reference and local TripoSR prototype | assets/models/ptz_touchscreen_clean.md; assets/source/ptz_touchscreen/reference.jpeg |

The owner authorized public deployment of the runtime simulator on 2026-09-26 and explicitly confirmed the hooded character permission after rechecking. This records the owner’s confirmation; it does not grant reuse rights to third parties. The authoring repository remains private.

Model weights, Python environments, CUDA libraries, and Blender binaries are not redistributed. They are optional authoring dependencies; browser playback uses exported GLBs and MP3s only.

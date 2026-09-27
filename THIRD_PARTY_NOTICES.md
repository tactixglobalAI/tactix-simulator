# Dependency and asset provenance

This project contains mixed-license assets. No blanket open-source license or public redistribution grant is asserted for the repository.

| Component | Source / permission | Included records |
|---|---|---|
| Three.js 0.128.0 and GLTFLoader | three npm distribution, MIT | vendor/three-0.128.0/LICENSE |
| Kokoro narration | Apache-2.0 engine and Kokoro-82M model; stock bf_emma voice | assets/audio/narration/README.md and KOKORO-LICENSE.txt |
| Interceptor launch sound | First ten seconds of user-provided PrototypeV1InterceptorLaunch.mp4, supplied with explicit instruction to incorporate into this simulator | assets/audio/interceptor/README.md |
| Bolero vehicle | Downloaded source; owner states licensed; exact redistribution terms not supplied | README.md; assets/source/bolero_camper |
| Tactical officer | Owner-supplied licensed asset; exact redistribution terms not supplied | README.md; assets/source/tactical_officer |
| Hooded male | Owner rechecked and confirmed permission for this public simulator deployment on 2026-09-26; creator/download URL and license text not supplied | assets/source/hooded_male/README.md |
| Touchscreen enclosure | Project-authored mechanical geometry based on user-supplied Gemini reference and local TripoSR prototype | assets/models/ptz_touchscreen_clean.md; assets/source/ptz_touchscreen/reference.jpeg |

The owner authorized public deployment of the runtime simulator on 2026-09-26 and explicitly confirmed the hooded character permission after rechecking. This records the owner’s confirmation; it does not grant reuse rights to third parties. The authoring repository remains private.

Model weights, Python environments, CUDA libraries, and Blender binaries are not redistributed. They are optional authoring dependencies; browser playback uses exported GLBs and MP3s only.

## Air-contact quadcopter

“Dji Mini 3 Pro” by aurumjuda747, licensed CC BY 4.0.
Source: https://sketchfab.com/3d-models/dji-mini-3-pro-274f2ad2731e42b793b784c9f8453677
Author: https://sketchfab.com/aurumjuda747
License: https://creativecommons.org/licenses/by/4.0/
Original supplied GLB retained in assets/source/air-contact (authoring repository only).
Modified for this simulator: joined static meshes, decimated geometry, resized textures, centered origin. Actual source dimensions preserved. Runtime asset: assets/models/air_contact_quadcopter.glb. Product shape does not establish manufacturer classification in the scenario.

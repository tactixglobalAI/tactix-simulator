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

## US-region SUV

Police Interceptor SUV by 3dmi, purchased source supplied by the owner from CGTrader: https://www.cgtrader.com/3d-models/car/suv/police-interceptor-suv . Owner confirmed license clearance. This records that confirmation and grants no independent model redistribution rights to visitors. Source masters stay in the private authoring repository. US runtime adaptations: metre scale/orientation, wheel separation, materials, enlarged existing computer screen, measured roof platform, driver sockets and live instrument texture. Runtime asset: assets/models/us_police_suv.glb.

US hooded NPC reuses the credited hooded source with project-authored Walk, StandToCrouch and kneeling idle poses; original rig/skinning retained. Runtime asset: assets/models/us_hooded_npc.glb.

## US recon and camera visualization

Recon component STLs supplied by the project owner; original filename recondroneSTL. Source archive and checksum provenance stay in assets/source/recon in the authoring repository. Modified by simplification, mm-to-metre conversion, authored materials and cradle. Runtime: assets/models/us_recon_docked.glb. No license document was included in the supplied archive.

OAK-D S2 PoE camera appearance is project-authored from owner-provided product references, with approximate housing dimensions from the Luxonis datasheet: https://www.mouser.com/pdfDocs/OAK-D-S2-PoE_Datasheet.pdf . It is a visual approximation, not manufacturer CAD, a tested physical mount, or an endorsement.

US quadcopter derivative retains the above CC BY 4.0 attribution. Separate original blade meshes, motor-axis pivots and runtime swept disks were added in assets/models/us_air_contact_quadcopter.glb.

US narration uses the same credited Kokoro model with af_heart American female voice weights; all US MP3s are local generated assets. No Google voice or service is used.

The optional US systems-tour preview uses Kokoro `am_michael` American male narration, generated locally at speed 0.96 from the same pinned model revision. Only rendered MP3s are delivered to browsers; there is no cloud speech service. Enclosure and Jetson reference images in `us/assets/systems-tour/` were supplied by the user for this preview; they are illustrative hardware references, not authored CAD or evidence of models running in the browser.

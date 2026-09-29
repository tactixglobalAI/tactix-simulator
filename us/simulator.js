(function () {
  "use strict";

  const ASSETS = Object.freeze({
    cockpit: "assets/models/us_police_suv.glb?v=driver-monitor-5",
    officer: "assets/models/tactical_officer_rigged.glb?v=5",
    npc: "assets/models/us_hooded_npc.glb?v=kneel-4",
    touchscreen: "assets/models/ptz_touchscreen_clean.glb?v=1",
    ptz: "assets/models/ptz_roof.glb?v=white-panels-1",
    roofPlatform: "assets/models/roof_platform.glb?v=1",
    reconDrone: "PROCEDURAL_PLACEHOLDER",
    interceptor: "assets/models/interceptor_docked.glb?v=2"
  });

  const STATES = Object.freeze({
    LOADING: "LOADING",
    READY: "READY",
    EXTERIOR_THIRD_PERSON: "EXTERIOR THIRD PERSON",
    VEHICLE_ENTRY_AVAILABLE: "VEHICLE ENTRY AVAILABLE",
    VEHICLE_ENTRY_TRANSITION: "VEHICLE ENTRY TRANSITION",
    VEHICLE_FIRST_PERSON: "VEHICLE FIRST PERSON",
    PATROL: "PATROLLING",
    CONTACT: "CONTACT DETECTED",
    INSPECTING: "INSPECTING CONTACT",
    TRACKING: "TRACKING CONTACT",
    LAUNCH_READY: "LAUNCH REVIEW",
    LAUNCHING: "INTERCEPTOR LAUNCH",
    PATROL_FINALE: "PATROL REVIEW",
    COMPLETE: "SCENARIO COMPLETE",
    DISMISSED: "CONTACT DISMISSED"
  });

  const el = {
    stage: document.getElementById("stage"),
    canvas: document.getElementById("scene"),
    startPanel: document.getElementById("startPanel"),
    enter: document.getElementById("enterButton"),
    entryPrompt: document.getElementById("vehicleEntryPrompt"),
    entryButton: document.getElementById("vehicleEntryButton"),
    entryFade: document.getElementById("entryFade"),
    console: document.getElementById("console"),
    state: document.getElementById("stateLabel"),
    sentry: document.getElementById("sentryLabel"),
    alert: document.getElementById("contactAlert"),
    sensor: document.getElementById("sensorFrame"),
    sensorTarget: document.getElementById("sensorTarget"),
    sensorMode: document.getElementById("sensorMode"),
    message: document.getElementById("systemMessage"),
    emptyTracks: document.getElementById("emptyTracks"),
    personTrack: document.getElementById("personTrack"),
    trackCount: document.getElementById("trackCount"),
    trackConfidence: document.getElementById("trackConfidence"),
    trackState: document.getElementById("trackState"),
    patrol: document.getElementById("patrolButton"),
    thermal: document.getElementById("thermalButton"),
    track: document.getElementById("trackButton"),
    ignore: document.getElementById("ignoreButton"),
    speed: document.getElementById("speedLabel"),
    driveMode: document.getElementById("driveModeLabel"),
    clock: document.getElementById("consoleClock"),
    scanReadout: document.getElementById("ptzScanReadout"),
    scanArrow: document.getElementById("ptzScanArrow"),
    scanStatus: document.getElementById("ptzScanStatus"),
    scanAngle: document.getElementById("ptzScanAngle"),
    viewToggle: document.getElementById("vehicleViewToggle"),
    lookHint: document.getElementById("lookHint")
  };

  const renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x171821);
  scene.fog = new THREE.FogExp2(0x6e7a80, 0.006);

  // Camera-relative sky: no translation/parallax, including the independent PTZ.
  // Analytic colours and crescent need no texture downloads or extra render pass.
  const duskSky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        horizon: { value: new THREE.Color(0xb9aaa0).convertSRGBToLinear() },
        rose: { value: new THREE.Color(0x829096).convertSRGBToLinear() },
        blue: { value: new THREE.Color(0x536f83).convertSRGBToLinear() },
        zenith: { value: new THREE.Color(0x233b51).convertSRGBToLinear() },
        moonDirection: { value: new THREE.Vector3(-.20, .43, -1).normalize() }
      },
      vertexShader: `varying vec3 skyDirection;
        void main() { skyDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec3 skyDirection;
        uniform vec3 horizon, rose, blue, zenith, moonDirection;
        void main() {
          vec3 d=normalize(skyDirection);
          float h=max(d.y,0.0);
          float sunset=pow(max(dot(normalize(vec3(d.x,0.0001,d.z)),vec3(0.,0.,-1.)),0.),3.);
          vec3 low=mix(blue*.65,horizon,sunset*.85+.15);
          vec3 colour=mix(low,rose,smoothstep(0.,.17,h));
          colour=mix(colour,blue,smoothstep(.12,.40,h));
          colour=mix(colour,zenith,smoothstep(.35,.90,h));
          vec3 right=normalize(cross(moonDirection,vec3(0.,1.,0.)));
          vec3 up=normalize(cross(right,moonDirection));
          vec2 m=vec2(dot(d,right),dot(d,up));
          float radius=.010;
          float disk=(1.-smoothstep(radius-.0004,radius+.0004,length(m)))*step(0.,dot(d,moonDirection));
          float shadow=1.-smoothstep(radius-.0004,radius+.0004,length(m-vec2(-.004,.003)));
          colour=mix(colour,vec3(.93,.91,.79),disk*(1.-shadow));
          gl_FragColor=vec4(colour,1.);
          #include <encodings_fragment>
        }`
    }));
  duskSky.name='DuskSky'; duskSky.frustumCulled=false; duskSky.renderOrder=-1000;
  duskSky.onBeforeRender=(_renderer,_scene,viewCamera)=>{
    duskSky.matrixWorld.makeTranslation(
      viewCamera.position.x,viewCamera.position.y,viewCamera.position.z);
  };
  scene.add(duskSky);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 500);
  const sensorCamera = new THREE.PerspectiveCamera(24, 16 / 9, 0.1, 300);
  const vehicle = new THREE.Group();
  vehicle.name = "PATROL_VEHICLE";
  scene.add(vehicle);

  let state = STATES.LOADING;
  let stateStarted = performance.now();
  let cockpit = null;
  let mountedTouchscreen=null, touchscreenSurface=null, touchscreenUI=null;
  let operatorEye = null;
  let doorEntry = null;
  let entryDoor = null;
  let ptzMount = null;
  let selectedScenario="patrol", launchData=null, launchFlight=null, launchRotors=[], launchTime=0, launchCount=0, aerialContact=null;
  const airContactRotors=[];
  const air = {phase:"IDLE",time:0,acquired:0,pan:0,tilt:0,fov:32,cueZ:0,launchBearing:0,approach:null,confirmed:false,history:[]};
  const aircraftLabels=['INTERCEPTOR 01','AIR CONTACT 01'].map(text=>{
    const label=document.createElement('span');label.className='aircraft-label';label.textContent=text;label.hidden=true;label.setAttribute('aria-hidden','true');el.stage.appendChild(label);return label;
  });
  let roofHardware=null, ptzPan=null, ptzTilt=null, ptzOptical=null, ptzRig=null, interceptorRig=null, reconRig=null;
  const interactionTargets = {};
  const rigBones = {};
  const characterController = {
    radius: 0.29,
    height: 1.82,
    groundCollision: true,
    vehicleCollision: true,
    cabinCollisionIgnored: false
  };
  let vehicleCollisionBox = null;
  let debugEntry = new URLSearchParams(window.location.search).has("debugEntry");
  let debugHelpersVisible = true;
  let debugGroup = null;
  const debugVisuals = [];
  let capsuleHelper = null;
  let skeletonHelper = null;
  let debugPaused = false;
  let debugPausedAt = 0;
  let debugCameraView = null;
  let walkPlan = null;
  let sensorVisible = false;
  let patrolStartedAt = 0;
  let contactTriggered = false;
  let yaw = -.22; // Slight leftward seated glance keeps road and center screen visible.
  let pitch = -0.10;
  const rollingWheels=[];
  let wheelTravel=0;
  let driverSpeedTarget=5;
  let officerSlowAt=null,officerSlowPending=false;
  let departureElapsed=null, patrolFinaleTime=null;
  let observationPlan=null;
  let systemsTour=null, systemsTourSelected=false;
  let personObservationTime=0, automaticPatrolAt=null, driverSightClear=false, nextSightCheck=0, postSendObservation=false, approachTracking=false;
  let clipMonitorAttention=false, clipReturnTimer=null;
  let observationPhase="NONE", resumeLookTime=0, manualLookUntil=0, screenAttention=false;
  let originalSpeedometer=null;
  const eventClip={status:"IDLE",sentAt:null,sendStarted:0,blob:null,url:null,recorder:null,stream:null,started:0,lastFrame:0,timer:null,frames:0,error:null};
  let recordingCanvas=null,recordingContext=null,recordingPixels=null,recordingImage=null;
  let seatedRootLocal=null;
  const seatedHeadRest={};
  let exteriorView = false;
  let exteriorYaw = .65, exteriorElevation = .40;
  let exteriorManual=false, exteriorManualDistance=0, exteriorCameraReady=false, exteriorCameraTime=0;
  const exteriorFocus=new THREE.Vector3(),exteriorLastVehicle=new THREE.Vector3();
  const seatedStates = [STATES.LAUNCH_READY,STATES.LAUNCHING,STATES.VEHICLE_FIRST_PERSON,STATES.PATROL,STATES.CONTACT,STATES.INSPECTING,STATES.TRACKING,STATES.DISMISSED];
  let pointerDown = false;
  let lastPointer = { x: 0, y: 0 };
  let introCameraStart = new THREE.Vector3();
  const clock = new THREE.Clock();
  let speechGeneration = 0;
  let narrationContext = null;
  let narrationSource = null;
  const narrationQueue=[];
  let narrationActiveText="";
  let narrationPlayed = 0, narrationBusy=false;
  const narrationHistory=[];
  let narrationError = null;
  const narrationBuffers = new Map();
  const narrationManifest = Promise.all(['assets/audio/narration/manifest.json?v=air-2','us/audio/narration/manifest.json?v=american-1'].map(url=>fetch(url).then(response=>{if(!response.ok)throw new Error('Narration manifest unavailable');return response.json();})))
    .then(([shared,regional])=>({...shared,clips:{...shared.clips,...regional.clips}}))
    .catch(error => { narrationError = error.message; return { clips: {} }; });
  let officerLoaded = false;
  let operatorMixer = null;
  let activeOperatorAction = null;
  const operatorActions = {};
  const dashDisplays = [];
  let lastDashDraw = 0;
  let entrySide = 1;
  const thermalColdMaterial = new THREE.MeshLambertMaterial({ color: 0x17242c });
  const thermalHotMaterial = new THREE.MeshBasicMaterial({ color: 0xffe0a0, skinning: true });

  const hemi = new THREE.HemisphereLight(0x8297c5, 0x30232b, 0.65);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xaec8ff, 0.65);
  moon.position.set(-18, 28, 12);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024,1024);
  moon.shadow.bias=-.0003;
  moon.shadow.normalBias=.008;
  scene.add(moon);
  const dusk = new THREE.DirectionalLight(0xffad79, 0.38);
  dusk.position.set(20, 12, -80);
  scene.add(dusk);

  const industrialEnvironment=buildUSIndustrialEnvironment(scene);

  function human(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.78 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x9a6a54, roughness: 0.9 });
    // Three.js r128 does not ship CapsuleGeometry in the core build. Keep the
    // stand-in human deliberately simple so a CDN version mismatch cannot stop
    // the simulator before the real operator asset is supplied.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.23, 0.72, 10), mat);
    body.position.y = 1.13;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 14, 10), skin);
    head.position.y = 1.82;
    g.userData.limbs = [];
    [-0.14, 0.14].forEach((x, i) => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 8), mat);
      leg.position.set(x, 0.43, 0);
      g.userData.limbs.push(leg);
      g.add(leg);
    });
    g.add(body, head);
    return g;
  }

  let operator = human(0x27384d);
  operator.position.set(4.8, 0, 2.8);
  scene.add(operator);

  const NPC_STATES = Object.freeze({ HIDDEN_CROUCH: 'HIDDEN_CROUCH', PEEK: 'PEEK', CROUCH_MOVE: 'CROUCH_MOVE' });
  const contact = new THREE.Group();
  contact.name = 'PERSON_ONE';
  const ENCOUNTER_Z = -70; // Exposed by the scenario five seconds after patrol starts.
  contact.position.set(8.2, 0, ENCOUNTER_Z);
  contact.rotation.y = -Math.PI / 2;
  contact.visible=false;
  scene.add(contact);
  let npcMixer = null, npcState = NPC_STATES.HIDDEN_CROUCH, npcTime = 0;
  let npcLoaded = false, npcHead = null, npcHeadBase = null;
  const npcActions = {};
  let sensorThermal = true;
  const PATROL_SPEED = 15/3.6; // relaxed patrol: 15 km/h internally, displayed as 9 mph
  const OBSERVATION_SPEED = 5 / 3.6; // intermediate slowdown: 5 km/h before stopping
  const SCAN_RATE = Math.PI / 10; // slow survey: one revolution every 20 seconds
  let manualPtz=false, manualPan=0, manualTilt=0;
  let scanAngle = 0, scanElapsed = 0, detectionEvidence = null;
  let vehicleSpeed = 0, patrolElapsed = 0;
  const ENCOUNTER_DELAY = 5;
  const SCAN_START_ANGLE = 1.2 + 5 * (Math.PI / 3 - SCAN_RATE); // Preserve encounter alignment at five seconds.
  const sensorTarget = new THREE.WebGLRenderTarget(512, 288);
  sensorTarget.texture.encoding = THREE.sRGBEncoding;
  const sensorScreen = new THREE.Scene();
  const sensorScreenCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  sensorScreen.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({map:sensorTarget.texture,depthTest:false,depthWrite:false})));
  const trackCanvas=document.createElement('canvas');trackCanvas.width=512;trackCanvas.height=288;
  const trackContext=trackCanvas.getContext('2d'),trackTexture=new THREE.CanvasTexture(trackCanvas);
  const trackOverlay=new THREE.Scene();
  trackOverlay.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({map:trackTexture,transparent:true,depthTest:false,depthWrite:false})));
  let sensorTrack={status:'NONE',box:null,label:'',lastSeen:0};
  const vegetation = new THREE.Group();
  vegetation.name = 'PERSON_ONE_VEGETATION';
  vegetation.position.z=ENCOUNTER_Z;
  scene.add(vegetation);
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x263e24, roughness: 1 });
  // Reusable opaque foliage: the same leaf clusters occlude visible and thermal views.
  // A roadside hedge and short return leave the garden side open for the exterior reveal.
  const leafGeometry=new THREE.SphereGeometry(1,5,3);
  const leafMaterials=[0x061309,0x0b2110,0x102b15,0x19361a].map(color=>new THREE.MeshStandardMaterial({color,roughness:1}));
  let foliageSeed=417;
  function foliageRandom(){foliageSeed=(foliageSeed*1664525+1013904223)>>>0;return foliageSeed/4294967296;}
  function hedgeSection(x,z,length,alongZ=true){
    const trunk=new THREE.Mesh(new THREE.BoxGeometry(alongZ?.16:length,.53,alongZ?length:.16),bushMat);
    trunk.position.set(x,.27,z);vegetation.add(trunk);
    for(let i=0;i<500;i++){
      const along=(foliageRandom()-.5)*length,across=(foliageRandom()-.5)*.56;
      const leaf=new THREE.Mesh(leafGeometry,leafMaterials[i%leafMaterials.length]);
      leaf.position.set(x+(alongZ?across:along),.22+foliageRandom()*.88,z+(alongZ?along:across));
      leaf.scale.set(.06+foliageRandom()*.055,.018+foliageRandom()*.018,.10+foliageRandom()*.08);
      leaf.rotation.set(foliageRandom()*3,foliageRandom()*3,foliageRandom()*3);leaf.castShadow=true;vegetation.add(leaf);
    }
  }
  for(const z of [-1.65,-.55,.55,1.65])hedgeSection(7.05,z,1.12);
  for(const x of [7.6,8.7,9.8])hedgeSection(x,-2.15,1.12,false);
  // Batch leaf clusters into four draw calls; preserve real depth occlusion.
  for(const material of leafMaterials){
    const leaves=vegetation.children.filter(o=>o.material===material);
    const batch=new THREE.InstancedMesh(leafGeometry,material,leaves.length);
    leaves.forEach((leaf,i)=>{leaf.updateMatrix();batch.setMatrixAt(i,leaf.matrix);vegetation.remove(leaf);});
    batch.castShadow=true;vegetation.add(batch);
  }


  function loadNpc(done) {
    new THREE.GLTFLoader().load(ASSETS.npc, gltf => {
      contact.add(gltf.scene);
      gltf.scene.traverse(obj => {
        if (obj.isBone && /Head$/.test(obj.name)) npcHead=obj;
        if (obj.isMesh) {
          obj.frustumCulled=false; obj.castShadow=true;
          for(const material of (Array.isArray(obj.material)?obj.material:[obj.material])) {
            material.transparent=false; material.opacity=1; material.depthWrite=true; material.side=THREE.FrontSide;
          }
        }
      });
      npcMixer=new THREE.AnimationMixer(gltf.scene);
      gltf.animations.forEach(clip => { npcActions[clip.name]=npcMixer.clipAction(clip); });
      if (!['CrouchIdle','CrouchWalk','StandToCrouch'].every(name => npcActions[name])) {
        el.enter.textContent='NPC ANIMATION LOAD FAILED'; return;
      }
      npcLoaded=true; updateNpc(0); done();
    },undefined,error => { console.error('NPC asset failed',error);el.enter.textContent='NPC LOAD FAILED — RELOAD'; });
  }

  function updateNpc(seconds) {
    if (!npcMixer) return;
    npcTime=seconds;
    contact.visible=true;
    const noticing=seconds<.8,walking=seconds>=.8 && seconds<3.2,settling=seconds>=3.2 && seconds<5.2;
    const progress=THREE.MathUtils.clamp((seconds-.8)/2.4,0,1);
    npcState=noticing?'NOTICE_PATROL':walking?'WALK_TO_COVER':settling?'LOWER_INTO_COVER':NPC_STATES.HIDDEN_CROUCH;
    const action=npcActions[walking?'Walk':noticing||settling?'StandToCrouch':'CrouchIdle'];
    for(const other of Object.values(npcActions)){other.enabled=other===action;if(other===action)other.play();}
    action.time=noticing?0:walking?(seconds-.8)%1.2:settling?Math.min(action.getClip().duration-.001,seconds-3.2):(seconds-5.2)%4;
    if(npcHead && npcHeadBase)npcHead.quaternion.copy(npcHeadBase);
    npcMixer.update(0);
    if(npcHead)npcHeadBase=npcHead.quaternion.clone();
    contact.position.x=9.96-1.76*progress;
    if(npcHead && noticing)npcHead.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-.18*Math.sin(seconds/.8*Math.PI)));
    contact.updateMatrixWorld(true);
  }

  function makeFallbackCockpit() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x111822, roughness: 0.65 });
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.35, 0.5), mat);
    dash.position.set(0, 1.0, -1.0);
    g.add(dash);
    operatorEye = new THREE.Object3D();
    operatorEye.name = "OperatorEye";
    operatorEye.position.set(0.456, 1.44, 0.12);
    g.add(operatorEye);
    entryDoor = new THREE.Object3D();
    entryDoor.name = "DriverDoor";
    g.add(entryDoor);
    ptzMount = new THREE.Object3D();
    ptzMount.position.set(0, 2.0, -0.45);
    g.add(ptzMount);
    const fallbackTargets = {
      driverDoorApproach: [1.22, 0, .35],
      driverDoorHandle: [0.98, 1.08, -0.55],
      driverSeat: [0.456, 0.66, 0.18],
      driverSeatPelvis: [0.456, 0.72, 0.18],
      driverFootwellLeft: [0.31, 0.16, -0.43],
      driverFootwellRight: [0.60, 0.16, -0.43],
      steeringWheelLeftHand: [0.31, 1.19, -0.31],
      steeringWheelRightHand: [0.60, 1.19, -0.31]
    };
    Object.entries(fallbackTargets).forEach(([name, position]) => {
      const target = new THREE.Object3D();
      target.name = name;
      target.position.set(position[0], position[1], position[2]);
      interactionTargets[name] = target;
      g.add(target);
    });
    return g;
  }

  function attachDisplayTexture(object, kind, width, height) {
    if (!object || !object.isMesh) return;
    const displayCanvas = document.createElement("canvas");
    displayCanvas.width = 512;
    displayCanvas.height = 256;
    const texture = new THREE.CanvasTexture(displayCanvas);
    texture.encoding = THREE.sRGBEncoding;
    const screenSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, color: 0xffffff })
    );
    screenSurface.name = kind === "cluster" ? "InstrumentClusterSurface" : "DashboardScreenSurface";
    screenSurface.position.copy(object.position);
    screenSurface.position.z += 0.021;
    cockpit.add(screenSurface);
    dashDisplays.push({ canvas: displayCanvas, context: displayCanvas.getContext("2d"), texture, kind });
  }

  function bindDisplaySurface(surface, kind) {
    if (!surface || !surface.isMesh) return false;
    const displayCanvas = document.createElement("canvas");
    displayCanvas.width = 512;
    displayCanvas.height = 256;
    const texture = new THREE.CanvasTexture(displayCanvas);
    texture.encoding = THREE.sRGBEncoding;
    texture.flipY = false;
    surface.material = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xffffff,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    dashDisplays.push({ canvas: displayCanvas, context: displayCanvas.getContext("2d"), texture, kind });
    return true;
  }

  function installOriginalSpeedometer() {
    const overlay=cockpit.getObjectByName('USSpeedSurface');if(overlay)overlay.visible=false;
    let material;
    cockpit.traverse(o=>{if(o.isMesh)for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m.name==='interior' && m.map)material=m;});
    if(!material)return;
    const source=material.map.image,canvas=document.createElement('canvas');
    canvas.width=source.width;canvas.height=source.height;
    const context=canvas.getContext('2d');context.drawImage(source,0,0);
    const texture=material.map.clone();texture.image=canvas;texture.needsUpdate=true;material.map=texture;
    originalSpeedometer={canvas,context,texture,source,last:null};
  }
  function drawOriginalSpeedometer() {
    if(!originalSpeedometer)return;
    const d=originalSpeedometer,value=Math.round(vehicleSpeed*2.236936).toString();
    if(d.last===value)return;d.last=value;
    const c=d.context,k=d.canvas.width/1600;
    c.save();c.scale(k,k);
    // Replace only the source atlas's digital number; preserve the instrument housing and MPH label.
    c.fillStyle='#09243d';c.beginPath();c.ellipse(491,88,22,25,0,0,Math.PI*2);c.fill();
    c.fillStyle='#e5f6ff';c.textAlign='center';c.font='32px sans-serif';c.fillText(value,491,100);
    c.restore();d.texture.needsUpdate=true;
  }

  function drawDashDisplays(now) {
    if (now - lastDashDraw < 250) return;
    lastDashDraw = now;
    drawOriginalSpeedometer();
    const moving = [STATES.PATROL, STATES.CONTACT, STATES.INSPECTING, STATES.TRACKING].includes(state);
    dashDisplays.forEach(display => {
      const ctx = display.context;
      ctx.fillStyle = "#06101a";
      ctx.fillRect(0, 0, display.canvas.width, display.canvas.height);
      ctx.strokeStyle = "#183d5b";
      ctx.lineWidth = 3;
      ctx.strokeRect(8, 8, 496, 240);
      ctx.fillStyle = "#659aca";
      ctx.font = "22px monospace";
      if (display.kind === "cluster") {
        ctx.fillText(selectedScenario==='interception'?"INTERCEPTOR":"NIGHT PATROL", 28, 48);
        ctx.fillStyle = "#e8f3ff";
        ctx.font = "bold 74px monospace";
        ctx.fillText(Math.round(vehicleSpeed*2.236936).toString(), 32, 144);
        ctx.fillStyle = "#7890a7";
        ctx.font = "20px monospace";
        ctx.fillText("mph        184° S", 34, 190);
      } else if ([STATES.CONTACT, STATES.INSPECTING, STATES.TRACKING].includes(state)) {
        const tracking = state === STATES.TRACKING;
        const thermalOpen = state === STATES.INSPECTING || tracking;
        ctx.fillText("SENTRY ONE PTZ // CONTACT", 24, 36);
        ctx.fillStyle = "#e5a63e";
        ctx.font = "bold 28px monospace";
        ctx.fillText(tracking ? "TRACKING PERSON 1" : "PERSON 1 DETECTED", 24, 72);

        ctx.fillStyle = "#09131b";
        ctx.fillRect(24, 88, 270, 142);
        ctx.strokeStyle = "#29485c";
        ctx.strokeRect(24, 88, 270, 142);
        ctx.fillStyle = thermalOpen ? "#ffd89a" : "#7f9aaa";
        ctx.beginPath();
        ctx.arc(159, 126, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(146, 142, 26, 49);
        ctx.strokeStyle = "#e5a63e";
        ctx.strokeRect(126, 105, 66, 100);
        ctx.beginPath();
        ctx.moveTo(159, 94);
        ctx.lineTo(159, 216);
        ctx.moveTo(112, 155);
        ctx.lineTo(206, 155);
        ctx.stroke();

        ctx.fillStyle = "#8ea2b7";
        ctx.font = "18px monospace";
        ctx.fillText("RANGE", 320, 112);
        ctx.fillStyle = "#eaf3fb";
        ctx.fillText("40 m", 420, 112);
        ctx.fillStyle = "#8ea2b7";
        ctx.fillText("MOTION", 320, 148);
        ctx.fillStyle = "#eaf3fb";
        ctx.fillText("STATIONARY", 420, 148);
        ctx.fillStyle = "#8ea2b7";
        ctx.fillText("CONF", 320, 184);
        ctx.fillStyle = "#e5a63e";
        ctx.fillText(tracking ? "0.74" : "0.62", 420, 184);
        ctx.fillStyle = tracking ? "#54d49a" : "#ffcf70";
        ctx.fillText(tracking ? "AUTO TRACK" : "REVIEW", 320, 222);
      } else {
        ctx.fillText("TACTIX // SENTRY ONE PTZ", 24, 44);
        ctx.fillStyle = "#54d49a";
        ctx.font = "bold 34px monospace";
        ctx.fillText(moving ? "360 SCAN" : "STANDBY", 24, 101);
        ctx.fillStyle = "#8ea2b7";
        ctx.font = "19px monospace";
        ctx.fillText("VISIBLE  ONLINE", 24, 154);
        ctx.fillText("THERMAL  ONLINE", 24, 187);
        ctx.fillText("LINK     NOMINAL", 24, 220);
      }
      display.texture.needsUpdate = true;
    });
  }

  function setState(next) {
    state = next;
    stateStarted = performance.now();
    el.state.textContent = next;
  }

  function prepareNarration() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    if (!narrationContext) narrationContext = new Context();
    narrationContext.resume().catch(error => { narrationError = error.message; });
    narrationManifest.then(manifest => {
      for (const clip of Object.values(manifest.clips)) loadNarration(clip);
    });
  }

  function loadNarration(clip) {
    if (!narrationBuffers.has(clip.file)) {
      narrationBuffers.set(clip.file, fetch(clip.file)
        .then(response => { if (!response.ok) throw new Error('Narration clip unavailable'); return response.arrayBuffer(); })
        .then(bytes => narrationContext.decodeAudioData(bytes))
        .catch(error => { narrationError = error.message; narrationBuffers.delete(clip.file); return null; }));
    }
    return narrationBuffers.get(clip.file);
  }

  function finishNarration() {
    narrationSource=null;
    setTimeout(()=>{
      narrationBusy=false;
      if(narrationQueue.length)speakNaturally(narrationQueue.shift());
    },700);
  }

  async function speakNaturally(text) {
    if(narrationBusy) {
      if(text!==narrationActiveText && !narrationQueue.includes(text))narrationQueue.push(text);
      return;
    }
    if(!narrationContext)return;
    narrationBusy=true;narrationActiveText=text;
    const manifest=await narrationManifest,clip=manifest.clips[text];
    if(!clip){finishNarration();return;}
    const buffer=await loadNarration(clip);
    if(!buffer || narrationContext.state!=='running'){finishNarration();return;}
    const source=narrationContext.createBufferSource();source.buffer=buffer;source.connect(narrationContext.destination);
    const record={text,start:performance.now(),end:null};narrationHistory.push(record);
    source.onended=()=>{record.end=performance.now();if(narrationSource===source)finishNarration();};
    narrationSource=source;
    if(text.includes('Slow down.') && officerSlowPending)officerSlowAt=patrolElapsed+(clip.slowdown_seconds??7.25);
    if(text.includes('Clip transmitted successfully') && clipMonitorAttention)returnToObservation((buffer.duration+.6)*1000);
    source.start();narrationPlayed++;
  }

  function setMessage(text, speak) {
    el.message.textContent = text;
    if (speak) speakNaturally(text);
  }

  function alertTone() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(720, ctx.currentTime);
    osc.frequency.setValueAtTime(920, ctx.currentTime + 0.16);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.38);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  }

  function enforceTransparentCabinGlass(root) {
    root.traverse(object => {
      if (!object.isMesh || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        if (!material || material.name.toLowerCase() !== "uscabinglass") return;
        material.transparent = true;
        material.opacity = 0.16;
        material.depthWrite = false;
        material.side = THREE.DoubleSide;
        material.metalness = 0;
        material.roughness = 0.08;
        if ("transmission" in material) material.transmission = 0;
        material.color.setRGB(0.72, 0.82, 0.90);
        material.needsUpdate = true;
      });
    });
  }

  function playOperatorAction(name, loop, fadeSeconds) {
    const action = operatorActions[name];
    if (!action) return;
    if (activeOperatorAction && activeOperatorAction !== action) {
      activeOperatorAction.fadeOut(fadeSeconds || 0.15);
    }
    action.reset();
    action.paused = false;
    action.enabled = true;
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.setLoop(loop === false ? THREE.LoopOnce : THREE.LoopRepeat, loop === false ? 1 : Infinity);
    action.clampWhenFinished = loop === false;
    action.fadeIn(fadeSeconds || 0.15);
    action.play();
    activeOperatorAction = action;
  }

  function targetPosition(name, fallback) {
    const target = interactionTargets[name];
    if (!target) return fallback.clone();
    const position = new THREE.Vector3();
    target.getWorldPosition(position);
    return position;
  }

  function collectRigBones() {
    const required = {
      hip: "CC_Base_Hip",
      neck: "CC_Base_NeckTwist01",
      head: "CC_Base_Head",
      leftThigh: "CC_Base_L_Thigh",
      leftCalf: "CC_Base_L_Calf",
      leftFoot: "CC_Base_L_Foot",
      rightThigh: "CC_Base_R_Thigh",
      rightCalf: "CC_Base_R_Calf",
      rightFoot: "CC_Base_R_Foot",
      leftUpperArm: "CC_Base_L_Upperarm",
      leftForearm: "CC_Base_L_Forearm",
      leftHand: "CC_Base_L_Hand",
      rightUpperArm: "CC_Base_R_Upperarm",
      rightForearm: "CC_Base_R_Forearm",
      rightHand: "CC_Base_R_Hand"
    };
    Object.entries(required).forEach(([key, name]) => {
      rigBones[key] = operator.getObjectByName(name) || null;
    });

  }

  // Foot planting correction for the existing walk, preserving limb lengths.
  const ENTRY_SECONDS = 2.8;
  const footRestRotation = {};
  let hipNeutralHeight = 0;
  let lastContactTargets = {};
  let entryTriggerCount = 0;
  const coarsePointer = window.matchMedia("(pointer: coarse)");

  function vehiclePoint(values) {
    return vehicle.localToWorld(new THREE.Vector3(...values));
  }

  function rotateBoneToward(bone, child, destination) {
    const start = bone.getWorldPosition(new THREE.Vector3());
    const current = child.getWorldPosition(new THREE.Vector3()).sub(start).normalize();
    const desired = destination.clone().sub(start).normalize();
    const correction = new THREE.Quaternion().setFromUnitVectors(current, desired);
    const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(correction);
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(parent.multiply(world));
    bone.updateMatrixWorld(true);
  }

  // Analytic two-bone IK with an explicit knee/elbow pole. No limb scaling.
  // The target is clamped to the physical reach rather than stretching bones.
  function solveContact(upper, lower, end, target, pole, weight, orientation) {
    if (!upper || !lower || !end || weight <= 0) return;
    operator.updateMatrixWorld(true);
    const a = upper.getWorldPosition(new THREE.Vector3());
    const b = lower.getWorldPosition(new THREE.Vector3());
    const c = end.getWorldPosition(new THREE.Vector3());
    const goal = c.clone().lerp(target, THREE.MathUtils.clamp(weight, 0, 1));
    const lengthA = a.distanceTo(b), lengthB = b.distanceTo(c);
    const delta = goal.clone().sub(a);
    const distance = THREE.MathUtils.clamp(delta.length(), Math.abs(lengthA-lengthB)+.001, lengthA+lengthB-.002);
    const direction = delta.normalize();
    const bend = pole.clone().sub(a).addScaledVector(direction, -pole.clone().sub(a).dot(direction)).normalize();
    const along = (lengthA*lengthA + distance*distance - lengthB*lengthB)/(2*distance);
    const knee = a.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0,lengthA*lengthA-along*along)));
    rotateBoneToward(upper, lower, knee);
    rotateBoneToward(lower, end, a.clone().addScaledVector(direction, distance));
    if (orientation) {
      const local = end.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation);
      end.quaternion.slerp(local, weight);
      end.updateMatrixWorld(true);
    }
  }

  function footContact(side, target, pole, weight) {
    const orientation = operator.getWorldQuaternion(new THREE.Quaternion()).multiply(footRestRotation[side] || new THREE.Quaternion());
    solveContact(rigBones[side+'Thigh'], rigBones[side+'Calf'], rigBones[side+'Foot'], target, pole, weight, orientation);
    lastContactTargets[side+'Foot'] = target.toArray();
  }

  function applyWalkContacts(u) {
    if (!walkPlan || !operatorActions.Walk || !rigBones.hip) return;
    const direction = walkPlan.end.clone().sub(walkPlan.start).normalize();
    const lateral = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),direction).normalize();
    const cycleDuration = operatorActions.Walk.getClip().duration;
    const cycles = walkPlan.duration/cycleDuration;
    const stride = walkPlan.start.distanceTo(walkPlan.end)/cycles;
    const contactWeight = phaseEase(u/.04)*(1-phaseEase((u-.94)/.06));
    // The imported hip is in centimetres; lower the pelvis slightly during
    // support so a planted foot stays reachable without stretching the leg.
    rigBones.hip.position.y = hipNeutralHeight-(4.5+.5*Math.sin(u*cycles*Math.PI*2))*contactWeight;
    rigBones.hip.updateMatrixWorld(true);
    ['left','right'].forEach((side,index) => {
      const offset = index*.5;
      const cycle = u*cycles+offset;
      const phase = cycle-Math.floor(cycle);
      const swing = phaseEase((phase-.5)/.5);
      const distance = (Math.floor(cycle)+.25-offset+swing)*stride;
      const target = walkPlan.start.clone().addScaledVector(direction,distance).addScaledVector(lateral,index === 0 ? .10:-.10);
      target.y = .102+(phase>.5 ? .13*Math.sin(Math.PI*(phase-.5)/.5):0);
      const pole = target.clone().addScaledVector(direction,.55);pole.y+=.45;
      footContact(side,target,pole,contactWeight);
    });

  }

  function addTargetMarker(target, color) {
    if (!target) return;
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 10, 8),
      new THREE.MeshBasicMaterial({ color, depthTest: false })
    );
    marker.renderOrder = 20;
    target.add(marker);
    debugVisuals.push(marker);
  }

  function createDebugVisualization() {
    if (debugGroup) return;
    debugGroup = new THREE.Group();
    debugGroup.name = "ENTRY_DEBUG_HELPERS";
    scene.add(debugGroup);

    const colors = {
      driverDoorApproach: 0x2ee6a6,
      driverDoorHandle: 0xffd34d,
      driverSeat: 0x8d7cff,
      driverSeatPelvis: 0xff5ad9,
      driverFootwellLeft: 0x49a7ff,
      driverFootwellRight: 0x1469ff,
      steeringWheelLeftHand: 0xff8a35,
      steeringWheelRightHand: 0xff3f35
    };
    Object.entries(colors).forEach(([name, color]) => addTargetMarker(interactionTargets[name], color));

    const collisionMaterial = new THREE.MeshBasicMaterial({
      color: 0xff355f,
      wireframe: true,
      transparent: true,
      opacity: 0.45,
      depthTest: false
    });
    [
      [1.78, 0.42, 4.30, 0, 0.34, 0],
      [1.72, 0.18, 2.05, 0, 1.66, 0.20],
      [1.55, 0.62, 0.48, 0, 1.00, -0.60]
    ].forEach(values => {
      const volume = new THREE.Mesh(new THREE.BoxGeometry(values[0], values[1], values[2]), collisionMaterial);
      volume.position.set(values[3], values[4], values[5]);
      vehicle.add(volume);
      debugVisuals.push(volume);
    });

    const capsuleMaterial = new THREE.MeshBasicMaterial({
      color: 0x35ff76,
      wireframe: true,
      transparent: true,
      opacity: 0.65,
      depthTest: false
    });
    capsuleHelper = new THREE.Group();
    const cylinderHeight = characterController.height - characterController.radius * 2;
    const cylinder = new THREE.Mesh(
      new THREE.CylinderGeometry(characterController.radius, characterController.radius, cylinderHeight, 14),
      capsuleMaterial
    );
    const top = new THREE.Mesh(new THREE.SphereGeometry(characterController.radius, 14, 10), capsuleMaterial);
    const bottom = top.clone();
    top.position.y = cylinderHeight / 2;
    bottom.position.y = -cylinderHeight / 2;
    capsuleHelper.add(cylinder, top, bottom);
    debugGroup.add(capsuleHelper);
    debugVisuals.push(capsuleHelper);

    if (officerLoaded) {
      skeletonHelper = new THREE.SkeletonHelper(operator);
      skeletonHelper.material.depthTest = false;
      skeletonHelper.material.transparent = true;
      skeletonHelper.material.opacity = 0.75;
      skeletonHelper.renderOrder = 19;
      debugGroup.add(skeletonHelper);
      debugVisuals.push(skeletonHelper);
    }
    debugGroup.visible = debugEntry && debugHelpersVisible;
    debugVisuals.forEach(object => { object.visible = debugEntry && debugHelpersVisible; });
  }

  function updateDebugVisualization() {
    if (!debugGroup) return;
    debugGroup.visible = debugEntry && debugHelpersVisible;
    debugVisuals.forEach(object => { object.visible = debugEntry && debugHelpersVisible; });
    if (capsuleHelper) {
      capsuleHelper.visible = operator.visible;
      capsuleHelper.position.copy(operator.position);
      capsuleHelper.position.y += characterController.height / 2;
    }
  }

  function loadOfficer(onComplete) {
    new THREE.GLTFLoader().load(
      ASSETS.officer,
      gltf => {
        scene.remove(operator);
        operator = gltf.scene;
        operator.name = "RIGGED_TACTICAL_OFFICER";
        operator.userData.limbs = [];
        operator.traverse(object => {
          if (object.isMesh || object.isSkinnedMesh) {
            object.castShadow = true;
            object.receiveShadow = true;
            object.frustumCulled = false;
            // This is a solid clothed body. The FBX exported it as blended,
            // double-sided geometry, exposing back surfaces through the skin.
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach(material => {
              material.transparent = false;
              material.opacity = 1;
              material.depthWrite = true;
              material.side = THREE.FrontSide;
              material.needsUpdate = true;
            });
          }
        });
        operatorMixer = new THREE.AnimationMixer(operator);
        gltf.animations.forEach(clip => {
          operatorActions[clip.name] = operatorMixer.clipAction(clip);
        });
        officerLoaded = true;
        scene.add(operator);
        collectRigBones();
        playOperatorAction('Idle', true, .001);
        operatorMixer.update(.02);
        operator.updateMatrixWorld(true);
        hipNeutralHeight = rigBones.hip.position.y;
        ['left','right'].forEach(side => {
          footRestRotation[side] = operator.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rigBones[side+'Foot'].getWorldQuaternion(new THREE.Quaternion()));
        });
        onComplete();
      },
      undefined,
      error => {
        console.error("Rigged officer failed; retaining procedural fallback", error);
        onComplete();
      }
    );
  }

  function installRoofHardware(done) {
    const load=url=>new Promise((resolve,reject)=>new THREE.GLTFLoader().load(url,resolve,undefined,reject));
    Promise.all([load(ASSETS.roofPlatform),load(ASSETS.ptz),load(ASSETS.interceptor),load('assets/models/us_recon_docked.glb?v=matte-black-2')]).then(([platform,ptz,interceptor,recon])=>{
      roofHardware=new THREE.Group();roofHardware.name='InstalledRoofHardware';cockpit.add(roofHardware);
      // US-specific rack is part of the SUV asset.
      ptzRig=ptz.scene;ptzRig.name='InstalledPTZ';ptzRig.position.set(0,1.822,-.18);roofHardware.add(ptzRig);
      interceptorRig=interceptor.scene;interceptorRig.name='InstalledInterceptor';interceptorRig.position.set(0,1.836,1.40);roofHardware.add(interceptorRig);
      reconRig=recon.scene;reconRig.name='InstalledRecon';reconRig.position.set(0,1.847,1.35);roofHardware.add(reconRig);
      updateRoofPayload();
      ptzPan=ptzRig.getObjectByName('PtzPan');ptzTilt=ptzRig.getObjectByName('PtzTilt');ptzOptical=ptzRig.getObjectByName('PtzOpticalOrigin');
      if(!ptzPan || !ptzTilt || !ptzOptical)throw new Error('PTZ articulation nodes missing');
      // Optical glass is absent from the STL. A modest lens face makes heading readable.
      const lens=new THREE.Mesh(new THREE.CircleGeometry(.018,24),new THREE.MeshStandardMaterial({color:0x305b72,metalness:.65,roughness:.18,side:THREE.DoubleSide}));
      lens.name='PtzLensFace';lens.rotation.y=Math.PI;lens.position.z=-.012;ptzOptical.add(lens);
      roofHardware.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
      roofHardware.updateMatrixWorld(true);TactixSightline.prepare(cockpit);updateSensorCamera();done();
    }).catch(error=>{console.error('Roof hardware load failed',error);el.enter.textContent='ROOF HARDWARE LOAD FAILED — RELOAD';});
  }

  function updateRoofPayload() {
    if(interceptorRig)interceptorRig.visible=selectedScenario==='interception';
    if(reconRig)reconRig.visible=selectedScenario==='patrol';
    cockpit?.traverse(o=>{if(o.name.includes('InterceptorAdapter'))o.visible=selectedScenario==='interception';});
  }

  function installTouchscreen(done) {
    mountedTouchscreen=cockpit.getObjectByName('DashboardScreenSurface');
    touchscreenSurface=mountedTouchscreen;
    touchscreenSurface.scale.multiplyScalar(.94);
    makeTouchscreenUI();done();
  }

  function makeTouchscreenUI() {
    const canvas=document.createElement('canvas');canvas.width=720;canvas.height=480;
    const texture=new THREE.CanvasTexture(canvas);texture.encoding=THREE.sRGBEncoding;
    const uiScene=new THREE.Scene();
    const uiCamera=new THREE.OrthographicCamera(0,720,480,0,.01,10);uiCamera.position.z=2;
    const background=new THREE.Mesh(new THREE.PlaneGeometry(720,480),new THREE.MeshBasicMaterial({map:texture}));
    background.position.set(360,240,0);uiScene.add(background);
    const feed=new THREE.Mesh(new THREE.PlaneGeometry(533,280),new THREE.MeshBasicMaterial({map:sensorTarget.texture}));
    feed.position.set(360,239,.1);uiScene.add(feed);
    const target=new THREE.WebGLRenderTarget(720,480);target.texture.encoding=THREE.sRGBEncoding;
    // glTF display UV origin is at the top; render-target origin is at the bottom.
    target.texture.repeat.y=-1;target.texture.offset.y=1;
    touchscreenSurface.material=new THREE.MeshBasicMaterial({map:target.texture,toneMapped:false});
    touchscreenUI={canvas,context:canvas.getContext('2d'),texture,scene:uiScene,camera:uiCamera,feed,target,lastLabel:null};
  }

  function finishEventRecording() {
    clearTimeout(eventClip.timer);
    if(eventClip.recorder?.state==='recording') {
      eventClip.status='FINALIZING';eventClip.recorder.stop();
    }
  }

  function startEventRecording() {
    if(eventClip.status!=='IDLE') return;
    if(!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      eventClip.status='UNAVAILABLE';eventClip.error='Recording is not supported in this browser';return;
    }
    try {
      recordingCanvas=document.createElement('canvas');recordingCanvas.width=512;recordingCanvas.height=288;
      recordingContext=recordingCanvas.getContext('2d');recordingContext.fillRect(0,0,512,288);
      recordingImage=recordingContext.createImageData(512,288);recordingPixels=new Uint8Array(512*288*4);
      eventClip.stream=recordingCanvas.captureStream(10);
      const mime=['video/webm;codecs=vp8','video/webm','video/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
      const recorder=new MediaRecorder(eventClip.stream,mime?{mimeType:mime}:undefined),chunks=[];
      eventClip.recorder=recorder;
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recorder.onstop=()=>{
        eventClip.stream.getTracks().forEach(track=>track.stop());
        if(eventClip.status==='ERROR')return;
        eventClip.blob=new Blob(chunks,{type:recorder.mimeType});
        if(!eventClip.blob.size || !eventClip.frames){eventClip.status='ERROR';return;}
        eventClip.url=URL.createObjectURL(eventClip.blob);eventClip.status='RECORDED';
      };
      recorder.onerror=()=>{eventClip.status='ERROR';eventClip.stream.getTracks().forEach(track=>track.stop());clearTimeout(eventClip.timer);};
      eventClip.started=performance.now();eventClip.status='RECORDING';recorder.start();
      eventClip.timer=setTimeout(finishEventRecording,10000);
    } catch(error) {
      eventClip.status='ERROR';eventClip.error=error.message;
      eventClip.stream?.getTracks().forEach(track=>track.stop());
    }
  }

  function captureEventFrame() {
    if(eventClip.status!=='RECORDING' || performance.now()-eventClip.lastFrame<95)return;
    eventClip.lastFrame=performance.now();
    renderer.readRenderTargetPixels(sensorTarget,0,0,512,288,recordingPixels);
    for(let y=0;y<288;y++)recordingImage.data.set(recordingPixels.subarray((287-y)*2048,(288-y)*2048),y*2048);
    recordingContext.putImageData(recordingImage,0,0);
    recordingContext.fillStyle='#07121bcc';recordingContext.fillRect(0,0,512,28);
    recordingContext.fillStyle='#ffce80';recordingContext.font='12px monospace';
    recordingContext.fillText('SENTRY ONE PTZ · PERSON UNCONFIRMED · '+(sensorThermal?'THERMAL':'VISIBLE'),8,18);
    eventClip.frames++;
  }

  function saveEventClip() {
    if(!eventClip.url)return;
    const a=document.createElement('a');a.href=eventClip.url;
    a.download='sentry-one-person-event.'+(eventClip.blob.type.includes('mp4')?'mp4':'webm');
    document.body.appendChild(a);a.click();a.remove();
  }

  function returnToObservation(delay=0) {
    clearTimeout(clipReturnTimer);
    clipReturnTimer=setTimeout(()=>{
      if(!clipMonitorAttention)return;
      clipMonitorAttention=false;manualLookUntil=0;
      if(['SIMULATED_SEND','KEPT_LOCAL'].includes(eventClip.status) && observationPhase==='OBSERVING'){startPatrolFinale();return;}
      expandedDialog.close();
    },delay);
  }

  function keepClipLocal(automatic=false) {
    if(eventClip.status!=='READY')return;
    eventClip.status='KEPT_LOCAL';
    if(automatic){eventClip.decisionTimedOut=true;setMessage('No response. Clip kept locally. Continuing patrol.',false);}
    for(let i=narrationQueue.length-1;i>=0;i--)if(narrationQueue[i].startsWith('Activity clip recorded.'))narrationQueue.splice(i,1);
    returnToObservation(800);
  }

  function simulateClipSend() {
    if(eventClip.status!=='READY')return;
    for(let i=narrationQueue.length-1;i>=0;i--)if(narrationQueue[i].startsWith('Activity clip recorded.'))narrationQueue.splice(i,1);
    clipMonitorAttention=true;manualLookUntil=0;clearTimeout(clipReturnTimer);
    eventClip.status='TRANSMITTING';eventClip.sendStarted=performance.now();
    setMessage('Transmitting clip to command center. Simulated transmission.',false);
    setTimeout(()=>{
      if(eventClip.status!=='TRANSMITTING')return;
      eventClip.sentAt=new Date().toLocaleTimeString([],{hour12:false});
      eventClip.status='SIMULATED_SEND';
      returnToObservation(8000); // Fallback when audio is unavailable.
      setMessage('Sentry One PTZ. Clip transmitted successfully to command center.',true);
    },3500);
  }

  function setDriverSpeed(speed) {
    officerSlowPending=false;officerSlowAt=null;
    driverSpeedTarget=speed;
    setMessage(speed===0?'Driver applied the brake.':speed<PATROL_SPEED?'Driver selected slow patrol.':'Driver resumed patrol speed.',false);
  }

  function proceedPatrol() {
    if(observationPhase!=='OBSERVING')return;
    observationPhase='RESUMING';postSendObservation=false;resumeLookTime=0;manualLookUntil=0;
    clipMonitorAttention=false;clearTimeout(clipReturnTimer);
    expandedDialog.close();
    setMessage('Officer returning attention to the road. Resuming patrol.',false);
  }

  function touchscreenControls() {
    const buttons=touchscreenBaseControls();
    if(selectedScenario==="interception"){
      if(['TRACKING','CONFIRM'].includes(air.phase))buttons.push({x:438,w:258,y:6,h:56,label:'VOICE COMMAND',physicalOnly:true,action:()=>{expandedDialog.showModal();expandedLabel='';}});
      return buttons;
    }
    if(seatedStates.includes(state) && state!==STATES.VEHICLE_FIRST_PERSON)buttons.push({x:438,w:258,y:6,h:56,label:manualPtz?'PTZ CONTROLS':'MANUAL PTZ',physicalOnly:true,action:()=>{
      expandedDialog.showModal();expandedLabel='';if(!manualPtz)manualButton.click();
    }});
    if(observationPhase==='OBSERVING' && !['READY','TRANSMITTING','SIMULATED_SEND'].includes(eventClip.status))buttons.push({x:24,w:672,y:324,h:56,label:'PROCEED WITH PATROL',action:proceedPatrol});
    return buttons;
  }

  function touchscreenBaseControls() {
    if(selectedScenario==='interception') {
      if(air.phase==='CONFIRM')return [{x:24,w:324,label:'CONFIRM LAUNCH',action:confirmAirLaunch},{x:372,w:324,label:'CANCEL',action:()=>{airPhase('TRACKING');setMessage('Launch cancelled. Tracking Air Contact One.',false);}}];
      if(air.phase==='TRACKING')return [{x:24,w:208,label:'FOLLOW',action:()=>setMessage('Following Air Contact One. Launch requires confirmation.',false)},{x:256,w:208,label:'LAUNCH DEMO',action:requestAirLaunch},{x:488,w:208,label:'DISMISS',action:dismissAirContact}];
      if(air.phase==='DISMISSED')return [{x:24,w:672,label:'END DEMO',action:finishAirObservation}];
      return [];
    }
    if(state===STATES.LAUNCHING)return [];
    if(state===STATES.VEHICLE_FIRST_PERSON)return [];
    if(!seatedStates.includes(state))return [];
    if(eventClip.status==='READY')return [
      {x:24,w:324,label:'SEND CLIP',action:simulateClipSend},
      {x:372,w:324,label:'KEEP LOCAL',action:keepClipLocal}
    ];
    if(eventClip.status==='TRANSMITTING')return [];
    if(['KEPT_LOCAL','SIMULATED_SEND'].includes(eventClip.status))return [
      {x:24,w:208,label:'SAVE CLIP',action:saveEventClip},
      {x:256,w:208,label:sensorThermal?'VISIBLE':'THERMAL',action:openThermal},
      {x:488,w:208,label:'DISMISS',action:dismissContact}
    ];
    if([STATES.CONTACT,STATES.INSPECTING,STATES.TRACKING].includes(state)) return [
      {x:24,w:208,label:sensorThermal?'VISIBLE':'THERMAL',action:openThermal},
      {x:256,w:208,label:'TRACK',action:trackContact},
      {x:488,w:208,label:'DISMISS',action:dismissContact}
    ];
    return [{x:24,w:672,label:sensorThermal?'VIEW VISIBLE':'VIEW THERMAL',action:()=>{sensorVisible=true;sensorThermal=!sensorThermal;}}];
  }

  function suggestedScreenAction(label) {
    return ['SEND CLIP','KEEP LOCAL','PROCEED WITH PATROL','AUTHORIZE LAUNCH','CONFIRM LAUNCH','LAUNCH DEMO','FOLLOW','DISMISS','CANCEL','END DEMO'].includes(label);
  }

  function renderTouchscreen() {
    if(!touchscreenUI)return;
    const ui=touchscreenUI,ctx=ui.context;
    const sendPulse=touchscreenControls().some(b=>suggestedScreenAction(b.label)) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pulseTime=sendPulse?Math.floor(performance.now()/50):0;
    const label=[selectedScenario==='interception'?Math.floor(air.time*4):ptzHolding()?personBearingLabel():0,pulseTime,state,observationPhase,manualPtz,eventClip.status,driverSpeedTarget,sensorVisible,sensorThermal,Math.round(vehicleSpeed*2.236936).toString(),el.message.textContent].join('|');
    if(label!==ui.lastLabel) {
      ui.lastLabel=label;
      ctx.fillStyle='#07121b';ctx.fillRect(0,0,720,480);
      ctx.fillStyle='#b9d8e9';ctx.font='bold 30px monospace';ctx.fillText('SENTRY ONE PTZ',48,38);
      ctx.fillStyle=ptzHolding()?'#efb94f':'#72d6ad';ctx.font='20px monospace';if(state===STATES.VEHICLE_FIRST_PERSON)ctx.fillText('STANDBY',420,31);
      ctx.fillStyle='#99adbc';ctx.font='20px monospace';
      ctx.fillText(Math.round(vehicleSpeed*2.236936).toString()+' mph · '+(selectedScenario==='interception'?(air.confirmed?'AIR CONTACT 01 · QUADCOPTER':air.phase==='PATROL'?'AIR SCAN':'AIR CONTACT · UNCONFIRMED'):ptzHolding()?personBearingLabel():state===STATES.DISMISSED?'DISMISSED · SCAN RESUMED':'VISIBLE + THERMAL ONLINE'),24,61);
      ctx.fillStyle=eventClip.status==='RECORDING'?'#ffb45a':'#b9d8e9';ctx.font='18px monospace';
      const recordingLabel={RECORDED:'CLIP RECORDED · OBSERVING PERSON',RECORDING:'● RECORDING ACTIVITY CLIP · 10 SECONDS',FINALIZING:'FINALIZING CLIP…',READY:'SEND CLIP TO COMMAND CENTER? · SIMULATED LINK',KEPT_LOCAL:'CLIP KEPT IN THIS SESSION · SAVE TO RETAIN',TRANSMITTING:'TRANSMITTING CLIP… · SIMULATED TRANSMISSION',SIMULATED_SEND:'✓ CLIP TRANSMITTED · '+eventClip.sentAt+' · SIMULATED',ERROR:'RECORDING FAILED',UNAVAILABLE:'RECORDING UNSUPPORTED IN THIS BROWSER'}[eventClip.status];
      if(selectedScenario==='interception'){ctx.fillStyle='#efb94f';ctx.fillText(airStatus(),24,83);}
      else if(recordingLabel)ctx.fillText(recordingLabel,24,83);
      if(!sensorVisible) {
        ctx.fillStyle='#b9d8e9';ctx.font='bold 32px monospace';ctx.textAlign='center';
        ctx.fillText(state===STATES.DISMISSED?'CONTACT DISMISSED':'OPERATOR SEATED',360,210);
        ctx.font='23px monospace';ctx.fillText(state===STATES.DISMISSED?'Sentry One PTZ has resumed scanning.':'Patrol starting automatically…',360,255);ctx.textAlign='left';
      }
      for(const button of touchscreenControls()) {
        const suggested=suggestedScreenAction(button.label);
        const glow=sendPulse?.5-.5*Math.cos(performance.now()*Math.PI*2/1600):1;
        ctx.fillStyle=suggested?`rgb(${Math.round(40+50*glow)},${Math.round(61+27*glow)},${Math.round(68-16*glow)})`:'#203e52';
        ctx.fillRect(button.x,button.y??388,button.w,button.h??84);
        if(suggested){
          ctx.save();ctx.strokeStyle='#ffd078';ctx.lineWidth=4;ctx.globalAlpha=.55+.45*glow;
          ctx.shadowColor='#ffc35f';ctx.shadowBlur=18*glow;
          ctx.strokeRect(button.x+3,(button.y??388)+3,button.w-6,(button.h??84)-6);ctx.restore();
        }
        ctx.fillStyle='#ffffff';ctx.font=(button.h?'bold 26px sans-serif':'bold 34px sans-serif');ctx.textAlign='center';ctx.fillText(button.label,button.x+button.w/2,(button.y??388)+(button.h??84)/2+11,button.w-24);ctx.textAlign='left';
      }
      ui.texture.needsUpdate=true;
    }
    ui.feed.visible=sensorVisible;
    const observing=observationPhase==='OBSERVING';
    ui.feed.scale.setScalar(observing?.78:1);ui.feed.position.y=observing?273:239;
    renderer.setRenderTarget(ui.target);renderer.render(ui.scene,ui.camera);renderer.setRenderTarget(null);
  }

  const expandedDialog=document.getElementById('touchscreenDialog');
  const expandedButton=document.getElementById('expandTouchscreen');
  const expandedFeed=document.getElementById('expandedFeed');
  const expandedContext=expandedFeed.getContext('2d');
  const expandedPixels=new Uint8Array(512*288*4);
  const expandedImage=expandedContext.createImageData(512,288);
  let expandedLastFrame=0,expandedLabel='';
  const airVoiceButton=document.createElement('button');airVoiceButton.id='airVoiceButton';airVoiceButton.type='button';airVoiceButton.textContent='USE VOICE COMMAND';airVoiceButton.hidden=true;
  const airVoiceHint=document.createElement('small');airVoiceHint.id='airVoiceHint';airVoiceHint.hidden=true;
  document.getElementById('expandedControls').after(airVoiceButton,airVoiceHint);
  airVoiceButton.addEventListener('click',listenAirCommand);
  function airCommand(words){
    const command=words.toLowerCase().replace(/[^a-z ]/g,'').trim();
    if(selectedScenario!=='interception')return false;
    if(command==='confirm' && air.phase==='CONFIRM'){confirmAirLaunch();return true;}
    if(command==='cancel' && air.phase==='CONFIRM'){airPhase('TRACKING');setMessage('Launch cancelled. Tracking Air Contact One.',false);return true;}
    if(air.phase!=='TRACKING')return false;
    if(command==='follow'){setMessage('Following Air Contact One. Launch requires confirmation.',false);return true;}
    if(command==='dismiss'){dismissAirContact();return true;}
    if(['engage','launch','launch demo'].includes(command)){requestAirLaunch();return true;}
    return false;
  }
  function listenAirCommand(){
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!Recognition){setMessage('Voice input unavailable in this browser. Use the touchscreen buttons.',false);return;}
    if(narrationBusy){setMessage('Wait for the voice announcement to finish, then tap Voice Command.',false);return;}
    const recognition=new Recognition();recognition.lang='en-US';recognition.continuous=false;recognition.interimResults=false;
    airVoiceButton.disabled=true;airVoiceButton.textContent='LISTENING…';
    const timer=setTimeout(()=>recognition.abort(),10000);
    recognition.onresult=event=>{if(!airCommand(event.results[0][0].transcript))setMessage('Command not recognized for this step. Use the touchscreen or try again.',false);};
    recognition.onerror=()=>setMessage('Voice input unavailable. Use the touchscreen buttons.',false);
    recognition.onend=()=>{clearTimeout(timer);airVoiceButton.disabled=false;airVoiceButton.textContent='USE VOICE COMMAND';};
    try{recognition.start();}catch(_){recognition.onend();recognition.onerror();}
  }
  expandedButton.addEventListener('click',()=>{prepareNarration();expandedDialog.showModal();expandedLabel='';});
  document.getElementById('closeTouchscreen').addEventListener('click',()=>expandedDialog.close());
  const manualButton=document.getElementById('manualPtzButton');
  const manualControls=document.getElementById('manualPtzControls');
  manualButton.addEventListener('click',()=>{
    manualPtz=!manualPtz;
    if(manualPtz){manualPan=-(ptzPan?.rotation.y||0);manualTilt=ptzTilt?.rotation.x||0;sensorVisible=true;sensorThermal=false;}
    else scanAngle=manualPan;
  });
  document.getElementById('manualSensorMode').addEventListener('click',()=>{sensorThermal=!sensorThermal;});
  document.querySelectorAll('[data-ptz-pan]').forEach(button=>button.addEventListener('click',()=>{
    manualPan=THREE.MathUtils.euclideanModulo(manualPan+Number(button.dataset.ptzPan)*Math.PI/18,Math.PI*2);
    manualTilt=THREE.MathUtils.clamp(manualTilt+Number(button.dataset.ptzTilt)*Math.PI/36,-Math.PI/3,Math.PI/3);
    updateSensorCamera();
  }));
  function updateExpandedTouchscreen(now) {
    expandedButton.hidden=!seatedStates.includes(state) || state===STATES.LAUNCHING;
    expandedButton.classList.toggle('suggested-action',!expandedDialog.open && innerWidth<=900 && (eventClip.status==='READY' || observationPhase==='OBSERVING' || (selectedScenario==='interception' && ['TRACKING','CONFIRM'].includes(air.phase))));
    document.getElementById('touchscreenFootnote').textContent=selectedScenario==='interception'?'Research visualization · launch only; no interception shown':'Vehicle touchscreen · command-center transmission is simulated';
    const voiceStep=selectedScenario==='interception' && ['TRACKING','CONFIRM'].includes(air.phase);
    airVoiceHint.hidden=!voiceStep;airVoiceButton.hidden=!voiceStep || !(window.SpeechRecognition||window.webkitSpeechRecognition);
    airVoiceHint.textContent=airVoiceButton.hidden?'Voice input is unavailable in this browser. All actions work by touch.':'Optional browser speech service; may use online processing. Tap to speak '+(air.phase==='CONFIRM'?'“Confirm” or “Cancel”.':'“Follow”, “Launch” or “Dismiss”.');
    if(!expandedDialog.open)return;
    manualButton.hidden=state===STATES.VEHICLE_FIRST_PERSON || selectedScenario==='interception';
    manualButton.textContent=manualPtz?'AUTO PTZ':'MANUAL PTZ';
    manualButton.setAttribute('aria-pressed',String(manualPtz));
    manualControls.hidden=!manualPtz;
    document.getElementById('manualSensorMode').textContent=sensorThermal?'THERMAL · SWITCH TO VISIBLE':'VISIBLE · SWITCH TO THERMAL';
    document.getElementById('manualPtzBearing').textContent=`Pan ${Math.round(THREE.MathUtils.euclideanModulo(manualPan*180/Math.PI,360))}° · Tilt ${Math.round(manualTilt*180/Math.PI)}°`;
    const labels={RECORDED:'Clip recorded · observing person',READY:'Send the recorded clip to command center?',TRANSMITTING:'Transmitting clip… · Simulated transmission',SIMULATED_SEND:'✓ Clip transmitted to command center · '+eventClip.sentAt+' · Simulated transmission',KEPT_LOCAL:'Clip kept in this session. SAVE CLIP to retain it.',RECORDING:'Recording activity clip…',ERROR:'Clip recording failed.',UNAVAILABLE:'Video recording is unavailable in this browser.'};
    const buttons=touchscreenControls().filter(button=>!button.physicalOnly && !(manualPtz && ['VISIBLE','THERMAL','VIEW VISIBLE','VIEW THERMAL'].includes(button.label)));
    const label=buttons.map(b=>b.label).join('|');
    document.getElementById('expandedStatus').textContent=Math.round(vehicleSpeed*2.236936).toString()+' mph · '+(observationPhase==='OBSERVING'?'Stopped · observing person. ':'')+(selectedScenario==='interception'?airStatus()+' · '+el.message.textContent:(labels[eventClip.status]||el.message.textContent)+(ptzHolding()?' · '+personBearingLabel():''));
    if(label!==expandedLabel) {
      expandedLabel=label;
      const controls=document.getElementById('expandedControls');controls.replaceChildren();
      for(const entry of buttons) {
        const button=document.createElement('button');button.type='button';button.textContent=entry.label;
        if(entry.w>300)button.className='wide';
        if(suggestedScreenAction(entry.label))button.classList.add('suggested-action');
        if(entry.label==='SEND CLIP')button.classList.add('clip-send-hint');
        button.addEventListener('click',()=>{prepareNarration();entry.action();});controls.appendChild(button);
      }
    }
    if(now-expandedLastFrame<100)return;expandedLastFrame=now;
    if(sensorVisible) {
      renderer.readRenderTargetPixels(sensorTarget,0,0,512,288,expandedPixels);
      for(let y=0;y<288;y++)expandedImage.data.set(expandedPixels.subarray((287-y)*2048,(288-y)*2048),y*2048);
      expandedContext.putImageData(expandedImage,0,0);
    } else {
      expandedContext.fillStyle='#07121b';expandedContext.fillRect(0,0,512,288);
      expandedContext.fillStyle='#b9d8e9';expandedContext.font='20px monospace';expandedContext.textAlign='center';
      expandedContext.fillText(state===STATES.VEHICLE_FIRST_PERSON?'PATROL STARTING…':'PTZ SCANNING',256,144);
    }
  }

  function pressTouchscreen(event) {
    if(!touchscreenSurface)return false;
    const rect=el.canvas.getBoundingClientRect();
    const pointer=new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    const ray=new THREE.Raycaster();ray.setFromCamera(pointer,camera);
    const hit=ray.intersectObject(touchscreenSurface)[0];if(!hit?.uv)return false;
    const x=hit.uv.x*720,y=hit.uv.y*480;
    const button=touchscreenControls().find(b=>x>=b.x && x<=b.x+b.w && y>=(b.y??388) && y<=(b.y??388)+(b.h??84));
    if(!button) {
      prepareNarration();expandedDialog.showModal();expandedLabel='';return true;
    }
    prepareNarration();button.action();return true;
  }

  function loadCockpit() {
    new THREE.GLTFLoader().load(
      ASSETS.cockpit,
      gltf => {
        cockpit = gltf.scene;
        cockpit.name = "US_POLICE_INTERCEPTOR";
        enforceTransparentCabinGlass(cockpit);
        vehicle.add(cockpit);
        operatorEye = cockpit.getObjectByName("OperatorEye");
        doorEntry = cockpit.getObjectByName("DoorEntry");
        interactionTargets.DoorEntry = doorEntry;
        [
          "driverDoorApproach",
          "driverDoorHandle",
          "driverDoorFrame",
          "driverSeat",
          "driverSeatPelvis",
          "driverFootwellLeft",
          "driverFootwellRight",
          "steeringWheelLeftHand",
          "steeringWheelRightHand"
        ].forEach(name => { interactionTargets[name] = cockpit.getObjectByName(name); });
        // Seat the officer slightly forward on the cushion to reach the US wheel.
        interactionTargets.driverSeatPelvis.position.z-=.08;
        entryDoor = cockpit.getObjectByName("DriverDoorPivot") || cockpit.getObjectByName("DriverDoor") || cockpit.getObjectByName("PassengerDoor");
        ptzMount = cockpit.getObjectByName("PTZMount");
        const dashboardBound = true; // Replaced by the separately loaded clean enclosure.
        const extraCluster=cockpit.getObjectByName('InstrumentClusterSurface');
        if(extraCluster)extraCluster.visible=false;
        installOriginalSpeedometer();
        if (!dashboardBound) attachDisplayTexture(cockpit.getObjectByName("DashboardScreen"), "sentry", 0.66, 0.41);
        if (doorEntry) {
          const entryPosition = new THREE.Vector3();
          doorEntry.getWorldPosition(entryPosition);
          entrySide = Math.sign(entryPosition.x) || 1;
        }
        cockpit.traverse(obj => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        installRollingWheels();
        vehicleCollisionBox = new THREE.Box3().setFromObject(cockpit);
        createDebugVisualization();
        installRoofHardware(()=>installTouchscreen(ready));
      },
      undefined,
      error => {
        console.error("Cockpit asset failed; using procedural fallback", error);
        cockpit = makeFallbackCockpit();
        vehicle.add(cockpit);
        ready();
      }
    );
  }

  function approachPosition() {
    const point = targetPosition('driverDoorApproach', vehiclePoint([1.22,0,.35]));
    // Leave room for the final boot swing beyond the standing capsule.
    return point.add(new THREE.Vector3(-.16,0,0).applyQuaternion(vehicle.getWorldQuaternion(new THREE.Quaternion())));
  }

  function ready() {
    setState(STATES.READY);
    el.entryPrompt.hidden = true;
    el.entryFade.style.opacity = '0';
    el.console.hidden = true;
    el.lookHint.hidden = true;
    if (entryDoor) entryDoor.rotation.y = 0;
    el.enter.disabled = false;
    el.enter.textContent = "START PATROL";
    document.getElementById("systemsTourButton").disabled=false;
    document.getElementById("systemsTourButton").textContent="PREVIEW SYSTEMS TOUR";
    document.getElementById("interceptionButton").disabled=false;
    document.getElementById("interceptionButton").textContent="START AIR CONTACT";
    if(sessionStorage.getItem("tactixReplay")==="interception"){sessionStorage.removeItem("tactixReplay");setTimeout(beginInterception,0);}
    if(sessionStorage.getItem("tactixReplay")==="systems-tour"){sessionStorage.removeItem("tactixReplay");setTimeout(()=>document.getElementById("systemsTourButton").click(),0);}
    characterController.vehicleCollision = true;
    characterController.cabinCollisionIgnored = false;
    operator.visible = true;
    operator.scale.setScalar(1);
    const approach = approachPosition();
    const vehicleRotation = new THREE.Quaternion();
    vehicle.getWorldQuaternion(vehicleRotation);
    const outward = new THREE.Vector3(entrySide, 0, 0).applyQuaternion(vehicleRotation);
    const rearward = new THREE.Vector3(0, 0, 1).applyQuaternion(vehicleRotation);
    operator.position.copy(approach).addScaledVector(outward, 3.35).addScaledVector(rearward, 2.45);
    operator.position.y = Math.max(operator.position.y, 0);
    operator.rotation.set(0, 0, 0);
    operator.quaternion.copy(facingQuaternion(operator.position, approach));
    playOperatorAction("Idle", true, 0.01);
    camera.position.set(entrySide * 8.2, 3.1, 9.2);
    camera.lookAt(0, 1.0, 0);
  }

  function beginIntro() {
    if (state !== STATES.READY) return;
    prepareNarration();
    document.getElementById("missionLabel").textContent="NIGHT PATROL";
    el.enter.disabled = true;
    el.startPanel.hidden = true;
    introCameraStart.copy(camera.position);
    const approach = approachPosition();
    const distance = operator.position.distanceTo(approach);
    const clipDuration = operatorActions.Walk ? operatorActions.Walk.getClip().duration : 0.82;
    const cycles = Math.max(1, Math.ceil(distance / 1.05));
    walkPlan = {
      start: operator.position.clone(),
      end: approach,
      duration: cycles * clipDuration
    };
    characterController.vehicleCollision = true;
    characterController.cabinCollisionIgnored = false;
    playOperatorAction("Walk", true, 0.18);
    setState(STATES.EXTERIOR_THIRD_PERSON);
  }

  function seatExteriorDriver() {
    if(!rigBones.hip || !operatorActions.SeatedDriver) return;
    operatorMixer.stopAllAction();
    const action=operatorActions.SeatedDriver;
    action.reset().setEffectiveWeight(1).play();
    operatorMixer.update(0);
    action.paused=true;
    activeOperatorAction=action;
    operator.rotation.set(0,Math.PI,0);
    operator.position.set(0,0,0);
    operator.updateMatrixWorld(true);
    operator.position.add(targetPosition('driverSeatPelvis',vehiclePoint([.456,.72,.18]))
      .sub(rigBones.hip.getWorldPosition(new THREE.Vector3())));
    operator.updateMatrixWorld(true);
    const spine=operator.getObjectByName('CC_Base_Waist') || operator.getObjectByName('CC_Base_Spine01');
    if(spine){
      const world=spine.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-.26));
      spine.quaternion.copy(spine.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
      operator.updateMatrixWorld(true);
    }
    for(const [side,x] of [['left',-.60],['right',-.34]]) {
      footContact(side,targetPosition('driverFootwell'+(side==='left'?'Left':'Right'),vehiclePoint([x,.16,-.43])),vehiclePoint([x,.95,-.65]),1);
      solveContact(rigBones[side+'UpperArm'],rigBones[side+'Forearm'],rigBones[side+'Hand'],
        targetPosition('steeringWheel'+(side==='left'?'Left':'Right')+'Hand',vehiclePoint([x,1.19,-.31])),
        vehiclePoint([side==='left'?-.78:-.10,.9,-.05]),1);
    }
    seatedRootLocal=vehicle.worldToLocal(operator.position.clone());
    for(const key of ['neck','head'])if(rigBones[key])seatedHeadRest[key]=rigBones[key].quaternion.clone();
  }

  function installRollingWheels() {
    cockpit.updateMatrixWorld(true);
    for(const name of ['WheelFrontLeft','WheelFrontRight','WheelRearLeft','WheelRearRight']) {
      const mesh=cockpit.getObjectByName(name);
      if(!mesh) continue;
      const bounds=new THREE.Box3().setFromObject(mesh);
      const center=bounds.getCenter(new THREE.Vector3());
      const size=bounds.getSize(new THREE.Vector3());
      const parent=mesh.parent,pivot=new THREE.Group();
      pivot.name=name+'Axle';pivot.position.copy(parent.worldToLocal(center));
      parent.add(pivot);pivot.updateMatrixWorld(true);pivot.attach(mesh);
      rollingWheels.push({pivot,radius:(size.y+size.z)/4});
    }
  }

  function enterOperatorMode() {
    seatExteriorDriver();
    operator.visible = exteriorView;
    if (entryDoor) entryDoor.rotation.y = 0;
    characterController.vehicleCollision = true;
    characterController.cabinCollisionIgnored = false;
    setState(STATES.VEHICLE_FIRST_PERSON);
    el.entryFade.style.opacity = '0';
    updateOperatorCamera(performance.now());
    el.console.hidden = true;
    el.lookHint.hidden = false;
    setTimeout(() => { el.lookHint.hidden = true; }, 3500);
    setMessage("Operator seated.", !systemsTourSelected);
    if(systemsTourSelected){sensorVisible=true;sensorThermal=false;systemsTour.start();}
  }

  // The gate is checked both when showing the prompt and on activation.
  // Coordinates are vehicle-local, so the passenger side never qualifies.
  function inDriverEntryArea(position = operator.position) {
    const local = vehicle.worldToLocal(position.clone());
    const approach = vehicle.worldToLocal(approachPosition());
    return local.x >= -1.85 && local.x <= -1.15 &&
      local.z >= -.10 && local.z <= .72 && Math.abs(local.y) < .15 &&
      Math.hypot(local.x-approach.x,local.z-approach.z) <= .45;
  }

  function updateEntryPrompt() {
    const available = state === STATES.VEHICLE_ENTRY_AVAILABLE && inDriverEntryArea();
    el.entryPrompt.hidden = !available;
    el.entryButton.disabled = !available;
    el.entryButton.textContent = coarsePointer.matches || navigator.maxTouchPoints > 0
      ? 'Tap to Enter Vehicle' : 'Press E to Enter Vehicle';
  }
  coarsePointer.addEventListener('change', updateEntryPrompt);

  function activateVehicleEntry() {
    if (state !== STATES.VEHICLE_ENTRY_AVAILABLE || !inDriverEntryArea()) return false;
    prepareNarration();
    entryTriggerCount += 1;
    el.entryPrompt.hidden = true;
    el.entryButton.disabled = true;
    operator.visible = false;
    if (operatorMixer) operatorMixer.stopAllAction();
    debugCameraView = null;
    pointerDown = false;
    introCameraStart.copy(camera.position);
    setState(STATES.VEHICLE_ENTRY_TRANSITION);
    return true;
  }
  el.entryButton.addEventListener('click', activateVehicleEntry);
  window.addEventListener('keydown', event => {
    if (event.code !== 'KeyE' || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (activateVehicleEntry()) event.preventDefault();
  });

  function contactBearing(worldPoint) {
    vehicle.updateMatrixWorld(true);
    const local=vehicle.worldToLocal(worldPoint.clone());
    const degrees=THREE.MathUtils.radToDeg(Math.atan2(local.x,-local.z));
    const hour=THREE.MathUtils.euclideanModulo(Math.round(degrees/30),12);
    const directionIndex=Math.abs(degrees)<3?0:Math.abs(degrees)<67.5?(degrees<0?7:1):THREE.MathUtils.euclideanModulo(Math.round(degrees/45),8);
    const direction=['ahead','ahead on the right','on the right','behind on the right','behind','behind on the left','on the left','ahead on the left'][directionIndex];
    return {degrees,direction,hour:hour||12,word:['twelve','one','two','three','four','five','six','seven','eight','nine','ten','eleven'][hour],range:local.length()};
  }
  function personBearingLabel() {
    const b=contactBearing(ptzTarget());
    return b.direction.toUpperCase();
  }

  function showContact() {
    if (contactTriggered) return;
    const detectionWorkStart=performance.now();
    contactTriggered = true;
    setState(STATES.TRACKING);
    el.sentry.textContent = "AUTO TRACK";
    el.alert.hidden = true;
    el.emptyTracks.hidden = true;
    el.personTrack.hidden = false;
    el.trackCount.textContent = "1 ACTIVE";
    el.thermal.disabled = false;
    el.thermal.textContent = 'VIEW PTZ VISIBLE';
    el.track.disabled = false;
    el.ignore.disabled = false;
    sensorVisible = true;
    sensorThermal = true;
    el.sensor.hidden = true;
    el.sensorTarget.textContent = 'PERSON 01 · UNCONFIRMED';
    el.sensorMode.textContent = 'THERMAL';
    document.querySelector('.track-panel').hidden = false;
    el.trackState.textContent = 'AUTO TRACK · UNCONFIRMED';
    observationPlan=planObservationStop();
    window.__patrolTiming={planMs:performance.now()-detectionWorkStart};
    approachTracking=false;nextSightCheck=0;officerSlowPending=true;officerSlowAt=patrolElapsed+7.25;
    startEventRecording();
    window.__patrolTiming.recordStartMs=performance.now()-detectionWorkStart-window.__patrolTiming.planMs;
    alertTone();
    const cue=contactBearing(contact.getWorldPosition(new THREE.Vector3()));
    if(detectionEvidence)detectionEvidence.clockCue=cue;
    const announcement=`Person detected, ${cue.direction}. Tracking and recording. Slow down.`;
    const detectedAt=patrolElapsed;
    narrationManifest.then(manifest=>{if(officerSlowPending)officerSlowAt=detectedAt+(manifest.clips[announcement]?.slowdown_seconds ?? 9);});
    setMessage(announcement,true);
  }

  function openThermal() {
    sensorVisible = true;
    sensorThermal = !sensorThermal;
    el.sensor.hidden = true;
    el.sensorTarget.textContent = "PERSON 01 · UNCONFIRMED";
    el.sensorMode.textContent = sensorThermal ? 'THERMAL' : 'VISIBLE';
    el.thermal.textContent = sensorThermal ? 'VIEW PTZ VISIBLE' : 'VIEW PTZ THERMAL';
    setState(state === STATES.TRACKING ? STATES.TRACKING : STATES.INSPECTING);
    el.sentry.textContent = sensorThermal ? 'THERMAL LIVE' : 'VISIBLE LIVE';
    if(sensorThermal) setMessage("Sentry One PTZ thermal is now displayed on the center console. Classification remains provisional.", true);
    else setMessage('Sentry One PTZ visible view. Person crouching behind vegetation; intent unconfirmed.', false);
  }

  function trackContact() {
    manualPtz=false;
    sensorVisible = true;
    el.sensor.hidden = true;
    setState(STATES.TRACKING);
    el.sentry.textContent = "TRACKING";
    el.sensorTarget.textContent = "PERSON 01 · TRACK ACTIVE";
    el.sensorMode.textContent = "AUTO TRACK";
    el.trackConfidence.textContent = "0.74";
    el.trackState.textContent = "TRACKING";
    setMessage("Tracking is active on the center console. No hostile action has been inferred.", true);
  }

  function dismissContact() {
    manualPtz=false;
    sensorVisible = false;
    el.sensor.hidden = true;
    el.alert.hidden = true;
    const display=dashDisplays.find(d=>d.kind==='sentry');
    const surface=cockpit.getObjectByName('DashboardScreenSurface');
    if(display && surface) surface.material.map=display.texture;
    finishEventRecording();
    setState(STATES.DISMISSED);
    el.sentry.textContent = "SCAN";
    el.driveMode.textContent = "DRIVER CONTROL";
    el.trackState.textContent = "DISMISSED";
    el.thermal.disabled = true;
    el.track.disabled = true;
    el.ignore.disabled = true;

    setMessage("Contact dismissed by the operator. Sentry One PTZ has resumed its scan.", true);
  }

  el.enter.addEventListener("click",()=>{systemsTourSelected=false;selectedScenario="patrol";beginIntro();});
  document.getElementById("systemsTourButton").addEventListener("click",()=>{if(state!==STATES.READY)return;systemsTourSelected=true;systemsTour.prepare();selectedScenario="patrol";beginIntro();});
  document.getElementById("interceptionButton").addEventListener("click",beginInterception);

  async function beginInterception(){
    if(state!==STATES.READY)return;
    systemsTourSelected=false;document.getElementById("systemsTourButton").disabled=true;
    prepareNarration();window.TactixLaunchAudio?.prepare();
    const button=document.getElementById('interceptionButton');button.disabled=true;el.enter.disabled=true;button.textContent='LOADING AIR CONTACT…';
    try {
      if(!launchData){const response=await fetch('assets/animations/interceptor-launch.json?v=1');if(!response.ok)throw new Error('Launch motion unavailable');launchData=await response.json();}
      if(!launchFlight){
        launchFlight=new THREE.Group();launchFlight.name='InterceptorLaunch';interceptorRig.add(launchFlight);interceptorRig.updateMatrixWorld(true);
        const parts=[];interceptorRig.traverse(o=>{if(o.isMesh && !o.name.includes('FluxGrip'))parts.push(o);});
        for(const part of parts)launchFlight.attach(part);
        const normalized=name=>name.replace(/[^a-z0-9]/gi,'').toLowerCase();
        for(const rotor of launchData.rotors){
          const mesh=parts.find(o=>normalized(o.name)===normalized(rotor.mesh));if(!mesh)throw new Error('Rotor mesh missing: '+rotor.mesh);
          const pivot=new THREE.Group();pivot.position.fromArray(rotor.pivot);launchFlight.add(pivot);pivot.updateMatrixWorld(true);pivot.attach(mesh);launchRotors.push(pivot);
        }
      }
      if(!aerialContact){
        const gltf=await new Promise((resolve,reject)=>new THREE.GLTFLoader().load('assets/models/us_air_contact_quadcopter.glb',resolve,undefined,reject));
        aerialContact=gltf.scene;aerialContact.name='AirContact01';scene.add(aerialContact);
        aerialContact.traverse(o=>{if(/^AirContactRotor[1-4]$/.test(o.name))airContactRotors.push({pivot:o,rest:o.quaternion.clone()});});
        if(airContactRotors.length!==4)throw new Error('Air contact requires four propeller pivots');
        for(const {pivot} of airContactRotors){
          // A faint swept disk avoids frozen-looking blades from frame-rate aliasing.
          const disk=new THREE.Mesh(new THREE.CircleGeometry(.073,32),new THREE.MeshBasicMaterial({color:0xa0a5a8,transparent:true,opacity:.14,side:THREE.DoubleSide,depthWrite:false}));
          disk.rotation.x=-Math.PI/2;disk.name='AirContactRotorBlur';pivot.add(disk);
        }
      }
      selectedScenario='interception';updateRoofPayload();launchTime=0;launchCount=0;el.startPanel.hidden=true;contact.visible=false;
      vehicleSpeed=driverSpeedTarget=0;observationPhase='NONE';manualPtz=false;sensorVisible=true;sensorThermal=false;
      enterOperatorMode();setState(STATES.LAUNCH_READY);yaw=-.35;pitch=-.13;
      Object.assign(air,{phase:'PATROL',time:0,acquired:0,pan:0,tilt:0,fov:32,cueZ:vehicle.position.z-22,confirmed:false,history:[]});
      aerialContact.position.set(96,20,vehicle.position.z-97);aerialContact.visible=true;
      scanAngle=0;vehicleSpeed=0;driverSpeedTarget=PATROL_SPEED;setState(STATES.PATROL);
      el.sentry.textContent='360° SCAN';
      document.getElementById('missionLabel').textContent='AIR CONTACT / LAUNCH DEMO';
      document.querySelector('.completion-card > p').textContent='TACTIXGLOBAL · AIR CONTACT';
      setMessage('Air patrol active. Sentry One PTZ scanning.',true);
      updateSensorCamera();updateOperatorCamera(performance.now());
    } catch(error){console.error(error);selectedScenario='patrol';setState(STATES.READY);el.startPanel.hidden=false;button.textContent='RETRY AIR CONTACT';button.disabled=false;el.enter.disabled=false;setMessage('Air scenario could not load. Please retry.',false);}
  }
  function airPhase(next) {
    el.sentry.style.color=['ACQUIRING','TRACKING','CONFIRM'].includes(next)?'#efb94f':'';
    air.phase=next;air.history.push({phase:next,time:air.time,vehicle:vehicle.position.toArray()});
  }
  function airStatus() {
    if(!aerialContact)return 'LOADING AIR CONTACT';
    if(air.phase==='PATROL')return '360° SCAN · INTERCEPTOR DOCKED';
    if(air.phase==='DISMISSED')return 'CONTACT DISMISSED · SCAN RESUMED';
    if(state===STATES.LAUNCHING || state===STATES.COMPLETE)return 'LAUNCH DEMONSTRATION · NO INTERCEPT EVENT';
    return `${contactBearing(aerialContact.getWorldPosition(new THREE.Vector3())).direction.toUpperCase()} · ${air.phase}`;
  }
  function requestAirLaunch() {
    if(air.phase!=='TRACKING')return;
    airPhase('CONFIRM');setMessage('Confirm interceptor launch demonstration.',true);
  }
  function confirmAirLaunch() {
    if(air.phase!=='CONFIRM')return;
    airPhase('BRAKING');driverSpeedTarget=0;
    setMessage('Launch confirmed. Stop vehicle.',true);
  }
  function dismissAirContact() {
    if(!['TRACKING','CONFIRM'].includes(air.phase))return;
    airPhase('DISMISSED');scanAngle=air.pan;setState(STATES.DISMISSED);
    setMessage('Contact dismissed by the operator. Sentry One PTZ has resumed its scan.',true);
  }
  function finishAirObservation() {
    expandedDialog.close();narrationQueue.length=0;if(narrationSource)narrationSource.stop();
    setState(STATES.COMPLETE);driverSpeedTarget=vehicleSpeed=0;
    document.getElementById('completionTitle').textContent='Air-contact review complete';
    const list=document.getElementById('completionSummary');list.replaceChildren();
    for(const text of ['Air contact visually classified as quadcopter','Operator dismissed contact','Interceptor remained docked']){const li=document.createElement('li');li.textContent=text;list.appendChild(li);}
    document.getElementById('viewRecordedClip').hidden=true;document.getElementById('completionPanel').hidden=false;
  }
  function updateAirContact(dt) {
    if(!aerialContact || state===STATES.COMPLETE || state===STATES.READY)return;
    air.time+=dt;
    airContactRotors.forEach(({pivot,rest},i)=>pivot.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),air.time*(i===0 || i===3?1:-1)*360)));
    // A pre-existing aircraft flies a slow lateral survey arc; no target spawning or pursuit guidance.
    aerialContact.position.x=96-28*Math.sin(air.time*.025);
    aerialContact.position.y=20+.12*Math.sin(air.time*.9);
    aerialContact.rotation.y=-Math.PI/2;
    aerialContact.rotation.z=.025*Math.sin(air.time*.5);
    contact.visible=false;
    if(state!==STATES.LAUNCHING){
      const previous=vehicleSpeed;
      vehicleSpeed=THREE.MathUtils.clamp(driverSpeedTarget,Math.max(0,previous-1.1*dt),previous+1.4*dt);
      const travel=(previous+vehicleSpeed)*.5*dt;vehicle.position.z-=travel;wheelTravel+=travel;
      rollingWheels.forEach(({pivot,radius})=>pivot.rotation.x=-wheelTravel/radius);
      el.speed.textContent=Math.round(vehicleSpeed*2.236936)+' mph';
    }
    if(air.phase==='PATROL' && vehicle.position.z<=air.cueZ){
      airPhase('ACQUIRING');driverSpeedTarget=0;setState(STATES.CONTACT);el.sentry.textContent='AIR CONTACT · AMBER';
      setMessage(`Air contact detected, ${contactBearing(aerialContact.getWorldPosition(new THREE.Vector3())).direction}. Sentry One PTZ slewing.`,true);
    }
    const tracking=['ACQUIRING','TRACKING','CONFIRM','BRAKING','LAUNCHING'].includes(air.phase);
    if(tracking){
      const delta=aerialContact.position.clone().sub(ptzOrigin());
      const pan=Math.atan2(delta.x,-delta.z),tilt=Math.atan2(delta.y,Math.hypot(delta.x,delta.z));
      const error=Math.atan2(Math.sin(pan-air.pan),Math.cos(pan-air.pan));
      air.pan+=THREE.MathUtils.clamp(error,-dt*.48,dt*.48);
      air.tilt+=THREE.MathUtils.clamp(tilt-air.tilt,-dt*.3,dt*.3);
      const aligned=Math.abs(error)<.012 && Math.abs(tilt-air.tilt)<.012;
      air.fov=THREE.MathUtils.lerp(air.fov,aligned?.17:32,1-Math.exp(-dt*1.8));
      if(air.phase==='ACQUIRING'){
        air.acquired=aligned && air.fov<.24?air.acquired+dt:0;
        if(air.acquired>1 && !narrationBusy){
          air.confirmed=true;airPhase('TRACKING');setState(STATES.TRACKING);el.sentry.textContent='AIR CONTACT 01 · TRACK ACTIVE';
          setMessage('Quadcopter confirmed. Tracking Air Contact One.',true);
        }
      }
    }else{air.pan+=dt*SCAN_RATE;air.tilt=0;air.fov=32;}
    if(air.phase==='BRAKING' && vehicleSpeed<.001 && !narrationBusy){
      air.launchBearing=air.pan;airPhase('LAUNCHING');setState(STATES.LAUNCH_READY);authorizeLaunch();
      speakNaturally('Interceptor launching.');
    }
  }
  function launchClearance() {
    if(!launchFlight)return null;
    scene.updateMatrixWorld(true);
    const moving=new THREE.Box3().setFromObject(launchFlight);
    const ptz=new THREE.Box3().setFromObject(ptzRig);
    const rack=new THREE.Box3().setFromObject(cockpit.getObjectByName('USRoofPlatform'));
    return {ptzOverlap:moving.intersectsBox(ptz),rackOverlap:moving.intersectsBox(rack),bottom:moving.min.y,deckTop:1.822+vehicle.position.y};
  }
  function launchPhase(){
    if(launchTime>=(launchData?.duration??8))return 'SKY APPROACH';if(launchTime<2.55)return 'DOCKED';if(launchTime<4.6)return 'ROTOR START';if(launchTime<5)return 'LIFT FROM DOCK';if(launchTime<157/30)return 'CLEAR VEHICLE';if(launchTime<5.5)return 'STABILIZE';if(launchTime<6)return 'PITCH FOR TRAVEL';if(launchTime<7)return 'ACCELERATE AWAY';return 'CLIMB';
  }
  function authorizeLaunch(){
    if(state!==STATES.LAUNCH_READY || !launchFlight)return;
    launchCount++;launchTime=0;air.approach=null;window.TactixLaunchAudio?.start();expandedDialog.close();setState(STATES.LAUNCHING);exteriorView=true;operator.visible=true;exteriorManual=false;
    camera.position.copy(vehicle.position).add(camera.aspect<1?new THREE.Vector3(8,5.5,11):new THREE.Vector3(5,3.8,7));camera.lookAt(vehicle.position.clone().add(new THREE.Vector3(0,2,0)));
    el.sentry.textContent='LAUNCH AUTHORIZED';setMessage('Launch authorized. Vehicle remains parked.',false);
  }
  function updateLaunch(dt){
    launchTime=Math.min(launchTime+dt,launchData.duration+5);
    const frame=Math.min(launchTime*launchData.fps,launchData.samples.length-1),i=Math.floor(frame),a=launchData.samples[i],b=launchData.samples[Math.min(i+1,launchData.samples.length-1)],u=frame-i;
    launchFlight.position.fromArray(a.p).lerp(new THREE.Vector3().fromArray(b.p),u);
    launchFlight.quaternion.fromArray(a.q).slerp(new THREE.Quaternion().fromArray(b.q),u);
    // Rotor harmonics in the reference begin near 2.65s. Extend spin-up to match
    // the cleaned audio lead-in; retain the reviewed lift/flight timeline unchanged.
    const rotorTime=launchTime<2.55?0:launchTime<4.6?3.5+(launchTime-2.55)*1.1/2.05:launchTime;
    const rf=Math.min(rotorTime*launchData.fps,launchData.samples.length-1),ri=Math.floor(rf);
    const ra=launchData.samples[ri],rb=launchData.samples[Math.min(ri+1,launchData.samples.length-1)];
    launchRotors.forEach((r,n)=>r.rotation.y=THREE.MathUtils.lerp(ra.rotors[n],rb.rotors[n],rf-ri));
    const departureTurn=-air.launchBearing*THREE.MathUtils.smoothstep(launchTime,5.5,7);
    launchFlight.position.applyAxisAngle(new THREE.Vector3(0,1,0),departureTurn);
    launchFlight.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),departureTurn));
    // Fixed cinematic continuation ends short of the other aircraft; no contact event.
    const extension=Math.max(0,launchTime-launchData.duration);
    if(extension>0){
      if(!air.approach){
        const start=launchFlight.position.clone();
        const target=interceptorRig.worldToLocal(aerialContact.getWorldPosition(new THREE.Vector3()));
        const heading=target.clone().sub(start);heading.y=0;heading.normalize();
        const end=target.clone().addScaledVector(heading,-12);end.y+=1.5;
        air.approach=new THREE.CubicBezierCurve3(start,start.clone().add(new THREE.Vector3(0,24,0)),end.clone().addScaledVector(heading,-24).add(new THREE.Vector3(0,2,0)),end);
      }
      const t=Math.min(extension/5,1),u=t+t*t-t*t*t;
      launchFlight.position.copy(air.approach.getPoint(u));
      const tangent=air.approach.getTangent(u).normalize();
      launchFlight.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),tangent),THREE.MathUtils.smoothstep(extension,0,1.2));
      launchRotors.forEach((r,n)=>r.rotation.y+=extension*90*(n<2?1:-1));
    }
    launchFlight.updateMatrixWorld(true);
    const craft=launchFlight.getWorldPosition(new THREE.Vector3());
    const oldAim=vehicle.position.clone().add(new THREE.Vector3(0,1.8,0)).lerp(craft,THREE.MathUtils.smoothstep(launchTime,4.6,6.5));
    const oldPosition=vehicle.position.clone().add(camera.aspect<1?new THREE.Vector3(8,5.5,11):new THREE.Vector3(5,3.8,7));
    const target=aerialContact.getWorldPosition(new THREE.Vector3());
    const direction=target.clone().sub(craft).normalize();
    const side=new THREE.Vector3().crossVectors(direction,new THREE.Vector3(0,1,0)).normalize();
    // Trailing sky shot keeps both real-scale aircraft in depth within the same frame.
    const horizontal=direction.clone();horizontal.y=0;horizontal.normalize();
    const skyPosition=craft.clone().addScaledVector(horizontal,-18).addScaledVector(side,2);
    skyPosition.y=Math.min(craft.y,target.y)-3;
    const toCraft=craft.clone().sub(skyPosition).normalize(),toTarget=target.clone().sub(skyPosition).normalize();
    const skyAim=skyPosition.clone().add(toCraft.clone().add(toTarget).normalize());
    const forward=toCraft.clone().add(toTarget).normalize();
    const viewRight=forward.clone().cross(new THREE.Vector3(0,1,0)).normalize();
    const viewUp=viewRight.clone().cross(forward).normalize();
    let halfFov=.07;
    for(const point of [craft,target]){
      const offset=point.clone().sub(skyPosition),depth=offset.dot(forward);
      halfFov=Math.max(halfFov,Math.atan((Math.abs(offset.dot(viewUp))+.45)/depth)*1.2,Math.atan((Math.abs(offset.dot(viewRight))+.45)/(depth*camera.aspect))*1.2);
    }
    const fitFov=THREE.MathUtils.radToDeg(halfFov*2);
    const skyBlend=THREE.MathUtils.smoothstep(launchTime,6.2,8.8);
    camera.position.copy(oldPosition.lerp(skyPosition,skyBlend));camera.fov=THREE.MathUtils.lerp(camera.aspect<1?65:48,Math.max(12,fitFov),skyBlend);camera.updateProjectionMatrix();camera.lookAt(oldAim.lerp(skyAim,skyBlend));
    for(const [index,point] of [craft,target].entries()){
      const p=point.clone().project(camera),label=aircraftLabels[index];label.hidden=launchTime<8.8 || p.z>1 || Math.abs(p.x)>.95 || Math.abs(p.y)>.9;
      label.style.left=(p.x*.5+.5)*100+'%';label.style.top=(-p.y*.5+.5)*100+'%';
    }
    el.message.textContent=launchPhase().replaceAll('_',' ');el.sentry.textContent=launchPhase();
    if(launchTime>=launchData.duration+5){
      aircraftLabels.forEach(label=>label.hidden=true);
      window.TactixLaunchAudio?.stop();
      setState(STATES.COMPLETE);document.getElementById('completionTitle').textContent='Launch demonstration complete';
      const list=document.getElementById('completionSummary');list.replaceChildren();
      for(const text of ['Launch authorized by operator','Vehicle remained stationary','Interceptor cleared roof hardware and approached the air contact']){const li=document.createElement('li');li.textContent=text;list.appendChild(li);}
      document.getElementById('viewRecordedClip').hidden=true;document.getElementById('completionPanel').hidden=false;document.getElementById('replayScenario').focus();
    }
  }

  function beginPatrol() {
    if(systemsTour?.active)return;
    if (state !== STATES.VEHICLE_FIRST_PERSON && state !== STATES.DISMISSED) return;
    driverSpeedTarget=PATROL_SPEED;officerSlowPending=false;officerSlowAt=null;observationPhase="NONE";observationPlan=null;
    patrolStartedAt = performance.now();
    contactTriggered = false;
    updateNpc(0);
    manualPtz=false;scanAngle=SCAN_START_ANGLE;scanElapsed=0;detectionEvidence=null;vehicleSpeed=0;patrolElapsed=0;contact.visible=true;
    sensorVisible=true;sensorThermal=false;el.sensor.hidden=true;
    el.sensorTarget.textContent="360° SCAN";el.sensorMode.textContent="VISIBLE";
    el.patrol.disabled = true;
    el.patrol.textContent = "PATROL ACTIVE";
    el.sentry.textContent = "360° SCAN";
    el.speed.textContent = "0 mph";
    el.driveMode.textContent = "PATROL";
    setState(STATES.PATROL);
    setMessage("Night patrol active. Sentry One PTZ is scanning in visible and thermal bands.", true);
  }
  el.patrol.addEventListener("click", beginPatrol);
  el.thermal.addEventListener("click", openThermal);
  el.track.addEventListener("click", trackContact);
  el.ignore.addEventListener("click", dismissContact);

  el.viewToggle.addEventListener("click", () => {
    if(!seatedStates.includes(state)) return;
    exteriorView=!exteriorView; pointerDown=false;exteriorManual=false;exteriorCameraReady=false;
    el.viewToggle.textContent=exteriorView?'DRIVER VIEW':'EXTERIOR VIEW';
    el.viewToggle.setAttribute('aria-pressed',String(exteriorView));
    el.lookHint.textContent=exteriorView?'DRAG TO ORBIT · DRIVER VIEW FOR TOUCHSCREEN':'DRAG TO LOOK AROUND';
    el.lookHint.hidden=false;
    updateOperatorCamera(performance.now());
  });

  let pointerStart=null,pointerDragged=false,activePointerId=null;
  el.canvas.addEventListener("pointerdown", event => {
    if(!seatedStates.includes(state) || !event.isPrimary || event.button!==0)return;
    pointerDown=true;pointerDragged=false;activePointerId=event.pointerId;
    pointerStart={x:event.clientX,y:event.clientY};lastPointer={...pointerStart};
    el.canvas.setPointerCapture(event.pointerId);
  });
  el.canvas.addEventListener("pointermove", event => {
    if(!pointerDown || event.pointerId!==activePointerId)return;
    if(!pointerDragged && Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)<10)return;
    pointerDragged=true;
    const dx=event.clientX-lastPointer.x,dy=event.clientY-lastPointer.y;
    if(exteriorView) {
      if(!exteriorManual){
        const delta=camera.position.clone().sub(vehicle.localToWorld(new THREE.Vector3(0,1.15,0)));
        exteriorManualDistance=delta.length();exteriorYaw=Math.atan2(delta.x,-delta.z);exteriorElevation=Math.asin(delta.y/delta.length());exteriorManual=true;
      }
      exteriorYaw-=dx*.005;
      exteriorElevation=THREE.MathUtils.clamp(exteriorElevation+dy*.004,.20,.85);
    } else {
      manualLookUntil=patrolElapsed+5;
      yaw=THREE.MathUtils.clamp(yaw-dx*.0032,-1.35,1.35);
      pitch=THREE.MathUtils.clamp(pitch-dy*.0027,-.55,.48);
    }
    lastPointer={x:event.clientX,y:event.clientY};
  });
  el.canvas.addEventListener("pointerup", event => {
    if(!pointerDown || event.pointerId!==activePointerId)return;
    const tap=!pointerDragged && Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)<10;
    pointerDown=false;activePointerId=null;
    if(tap && !exteriorView)pressTouchscreen(event);
  });
  el.canvas.addEventListener("pointercancel",()=>{pointerDown=false;activePointerId=null;});
  el.canvas.addEventListener("lostpointercapture",()=>{pointerDown=false;activePointerId=null;});
  function toggleDebugPause(force) {
    const next = typeof force === "boolean" ? force : !debugPaused;
    if (next === debugPaused) return;
    if (next) {
      debugPausedAt = performance.now();
    } else {
      stateStarted += performance.now() - debugPausedAt;
    }
    debugPaused = next;
  }

  function updateDebugCamera() {
    if (!debugEntry || !debugCameraView) return;
    const look = operator.visible ? operator.position.clone() : targetPosition("driverSeatPelvis", vehicle.position);
    look.y += 0.92;
    const localViews = {
      DRIVER_CLOSE: new THREE.Vector3(2.1, 1.55, -1.1),
      DRIVER_SIDE: new THREE.Vector3(3.8, 1.95, 0.25),
      FRONT_THREE_QUARTER: new THREE.Vector3(3.25, 2.05, -3.75),
      REAR_THREE_QUARTER: new THREE.Vector3(3.35, 2.05, 3.75)
    };
    if (debugCameraView === "INTERIOR") {
      if (operatorEye) operatorEye.getWorldPosition(camera.position);
      camera.lookAt(vehicle.localToWorld(new THREE.Vector3(0.35, 1.18, -7)));
      return;
    }
    if(debugCameraView==='DRIVER_CLOSE') look.copy(targetPosition("driverSeatPelvis",vehicle.position)).add(new THREE.Vector3(0,.40,0));
    const local = localViews[debugCameraView];
    if (local) {
      if (state === STATES.EXTERIOR_THIRD_PERSON) {
        camera.position.copy(operator.position).add(new THREE.Vector3(3.4,2.1,3.4));
      } else camera.position.copy(vehicle.localToWorld(local.clone()));
      camera.lookAt(look);
    }
  }

  window.addEventListener("keydown", event => {
    if (event.key.toLowerCase() === "d") {
      debugEntry = !debugEntry;
      updateDebugVisualization();
    } else if (debugEntry && event.code === "Space") {
      event.preventDefault();
      toggleDebugPause();
    } else if (debugEntry && ["1", "2", "3", "4"].includes(event.key)) {
      debugCameraView = ({ "1": "DRIVER_SIDE", "2": "FRONT_THREE_QUARTER", "3": "REAR_THREE_QUARTER", "4": "INTERIOR" })[event.key];
    }
  });

  window.__tactixEntryDebug = {
    systemsTourSnapshot(){return {...systemsTour.snapshot(),selected:systemsTourSelected,vehicle:vehicle.position.toArray(),speed:vehicleSpeed,thermal:sensorThermal};},
    sensorTrackingSnapshot(){
      const bounds=reconRig?new THREE.Box3().setFromObject(reconRig):null;
      return {track:sensorTrack,rotors:airContactRotors.map(({pivot})=>({name:pivot.name,quaternion:pivot.quaternion.toArray(),position:pivot.getWorldPosition(new THREE.Vector3()).toArray()})),reconVisible:reconRig?.visible,interceptorVisible:interceptorRig?.visible,recon:bounds?{min:bounds.min.toArray(),max:bounds.max.toArray(),ptzOverlap:bounds.intersectsBox(new THREE.Box3().setFromObject(ptzRig)),deckBottom:bounds.min.y-vehicle.position.y}:null,cameraFov:camera.fov,voice:narrationBuffers.size};
    },
    airCommand,
    bearingProbe(point){return debugEntry?contactBearing(new THREE.Vector3(...point)):null;},
    startPatrolReview() {
      if(!debugEntry)return;
      selectedScenario='patrol';vehicle.position.set(0,0,-40);setState(STATES.VEHICLE_FIRST_PERSON);
      el.startPanel.hidden=true;operator.visible=false;toggleDebugPause(true);beginPatrol();
    },
    airSnapshot(){return {phase:air.phase,time:air.time,confirmed:air.confirmed,history:air.history,pan:air.pan,tilt:air.tilt,fov:air.fov,target:aerialContact?.position.toArray(),vehicle:vehicle.position.toArray(),speed:vehicleSpeed,narrationBusy,buttons:touchscreenControls().map(b=>b.label),projection:aerialContact?.position.clone().project(sensorCamera).toArray()};},
    launchSnapshot(){return {craft:launchFlight?.getWorldPosition(new THREE.Vector3()).toArray(),target:aerialContact?.getWorldPosition(new THREE.Vector3()).toArray(),craftProjection:launchFlight?.getWorldPosition(new THREE.Vector3()).project(camera).toArray(),targetProjection:aerialContact?.getWorldPosition(new THREE.Vector3()).project(camera).toArray(),clearance:launchClearance(),scenario:selectedScenario,state,time:launchTime,phase:launchPhase(),count:launchCount,vehicle:vehicle.position.toArray(),flight:launchFlight?.position.toArray(),rotors:launchRotors.map(r=>r.rotation.y),scale:interceptorRig?.scale.toArray()};},
    patrolStep(dt, snapshot=true) {
      if(!debugEntry) return null;
      updatePatrolVehicle(dt);
      updateNpc(npcTime+dt);updatePtzScan(dt);updateSensorCamera();updateOperatorCamera(0);
      return snapshot ? this.npcSnapshot() : state;
    },
    planningProbe(x,z,speed) {
      if(!debugEntry)return null;
      const oldContact=contact.position.clone(),oldVegetation=vegetation.position.clone(),oldSpeed=vehicleSpeed;
      try {
        const delta=new THREE.Vector3(x,contact.position.y,z).sub(contact.position);
        contact.position.add(delta);vegetation.position.add(delta);vehicleSpeed=speed;
        const p=planObservationStop();return {stop:p.stop.toArray(),ahead:p.ahead,bearing:p.bearing,visibleSamples:p.visibleSamples,brakingDistance:p.brakingDistance,fallback:p.fallback};
      } finally {contact.position.copy(oldContact);vegetation.position.copy(oldVegetation);vehicleSpeed=oldSpeed;contact.updateMatrixWorld(true);vegetation.updateMatrixWorld(true);}
    },
    observationProbe(ahead) {
      if(!debugEntry)return null;
      toggleDebugPause(true);debugCameraView=null;vehicle.position.z=contact.position.z+ahead;
      vehicleSpeed=0;observationPhase='OBSERVING';clipMonitorAttention=false;nextSightCheck=0;
      vehicle.updateMatrixWorld(true);updateNpc(0);contact.visible=true;
      for(let i=0;i<300;i++)updateDriverAttention(1/60);
      updateOperatorCamera(0);
      const eye=operatorEye.getWorldPosition(new THREE.Vector3()),delta=contact.position.clone().sub(eye);
      return {eye:eye.toArray(),person:contact.position.toArray(),ahead:eye.z-contact.position.z,bearing:Math.atan2(delta.x,-delta.z)*180/Math.PI,clear:personSightlineClear(),yaw};
    },
    exteriorSnapshot() {
      const points=[vehicle.localToWorld(new THREE.Vector3(0,1.15,0)),contact.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,.85,0))];
      return {head:rigBones.head?.quaternion.toArray(),neck:rigBones.neck?.quaternion.toArray(),active:exteriorView,manual:exteriorManual,phase:observationPhase,focus:exteriorFocus.toArray(),position:camera.position.toArray(),projected:points.map(p=>p.project(camera).toArray())};
    },
    displaySnapshot() {
      const pixels=new Uint8Array(4);renderer.readRenderTargetPixels(touchscreenUI.target,650,34,1,1,pixels);
      return {pixelRatio:renderer.getPixelRatio(),buttonPixel:Array.from(pixels),screenSize:[touchscreenUI.target.width,touchscreenUI.target.height]};
    },
    speedometerSnapshot() {return {patrolFinaleTime,departureElapsed,observationPhase,plan:observationPlan?{stop:observationPlan.stop.toArray(),ahead:observationPlan.ahead,bearing:observationPlan.bearing,visibleSamples:observationPlan.visibleSamples,brakingDistance:observationPlan.brakingDistance,fallback:observationPlan.fallback}:null,approachTracking,postSendObservation,driverSightClear,personObservationTime,clipMonitorAttention,yaw,pitch,value:originalSpeedometer?.last,extraDisplayVisible:cockpit?.getObjectByName("InstrumentClusterSurface")?.visible,officerSlowPending,officerSlowAt};},
    eventSnapshot() {return {status:eventClip.status,decisionElapsed:eventClip.decisionElapsed||0,decisionTimedOut:!!eventClip.decisionTimedOut,sentAt:eventClip.sentAt,sendStarted:eventClip.sendStarted,bytes:eventClip.blob?.size||0,url:eventClip.url,frames:eventClip.frames,error:eventClip.error,driverSpeedTarget,vehicleSpeed};},
    driverSpeed(speed) {if(debugEntry && [0,OBSERVATION_SPEED,PATROL_SPEED].includes(speed))setDriverSpeed(speed);},
    clipChoice(choice) {if(!debugEntry)return;if(choice==='SEND')simulateClipSend();if(choice==='KEEP')keepClipLocal();},
    vehicleMotionSnapshot() {
      return {travel:wheelTravel,wheels:rollingWheels.map(({pivot,radius})=>({name:pivot.name,radius,angle:pivot.rotation.x,center:pivot.getWorldPosition(new THREE.Vector3()).toArray()})),driverVisible:operator.visible,seatedRoot:seatedRootLocal?.toArray()};
    },
    roofView(view='FRONT') {
      if(!debugEntry || !roofHardware)return null;
      toggleDebugPause(true);debugCameraView=null;operator.visible=false;el.startPanel.hidden=true;
      const offset=view==='TOP'?new THREE.Vector3(0,6,1):view==='SIDE'?new THREE.Vector3(4,3.1,0):new THREE.Vector3(3,3.1,-4.8);
      camera.position.copy(vehicle.position).add(offset);camera.lookAt(vehicle.position.clone().add(new THREE.Vector3(0,1.65,0)));
      return this.roofSnapshot();
    },
    roofSnapshot() {
      if(!roofHardware)return null;
      roofHardware.updateMatrixWorld(true);
      const box=o=>{const b=new THREE.Box3().setFromObject(o);return {min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new THREE.Vector3()).toArray()};};
      return {ptzProjection:ptzOrigin().project(camera).toArray(),ptz:box(ptzRig),interceptor:box(interceptorRig),pan:ptzPan.rotation.y,tilt:ptzTilt.rotation.x,opticalOrigin:ptzOrigin().toArray(),opticalDirection:new THREE.Vector3(0,0,-1).applyQuaternion(ptzOptical.getWorldQuaternion(new THREE.Quaternion())).toArray(),sensorDirection:sensorCamera.getWorldDirection(new THREE.Vector3()).toArray()};
    },
    touchscreenView() {
      if(!debugEntry || !mountedTouchscreen)return null;
      debugCameraView=null;toggleDebugPause(true);
      operatorEye.getWorldPosition(camera.position);
      const target=touchscreenSurface.getWorldPosition(new THREE.Vector3());camera.lookAt(target);
      return {position:mountedTouchscreen.position.toArray(),scale:mountedTouchscreen.scale.toArray(),surface:touchscreenSurface.name};
    },
    touchscreenButtons(rowY=446) {
      if(!touchscreenSurface)return null;
      const rect=el.canvas.getBoundingClientRect();
      return [128,360,592].map(x=>{
        const local=new THREE.Vector3(),g=touchscreenSurface.geometry,u=x/720,v=rowY/480;
        for(let i=0;i<g.attributes.position.count;i++) {
          const uv=new THREE.Vector2().fromBufferAttribute(g.attributes.uv,i);
          const weight=(uv.x>.5?u:1-u)*(uv.y>.5?v:1-v);
          local.addScaledVector(new THREE.Vector3().fromBufferAttribute(g.attributes.position,i),weight);
        }
        const point=local.applyMatrix4(touchscreenSurface.matrixWorld).project(camera);
        return {x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2};
      });
    },
    npcSample(seconds, view) {
      if(!debugEntry || !npcLoaded) return null;
      toggleDebugPause(true); debugCameraView=null;operator.visible=false;el.startPanel.hidden=true;el.console.hidden=true;
      selectedScenario="patrol";patrolElapsed=ENCOUNTER_DELAY;vehicle.position.z=ENCOUNTER_Z+3;showContact();updateNpc(seconds);updateSensorCamera();
      if(view==='DRIVER') { operatorEye.getWorldPosition(camera.position);camera.lookAt(contact.position.clone().add(new THREE.Vector3(0,.9,0))); }
      if(view==='ROAD_COVER') { camera.position.set(4.1,1.45,ENCOUNTER_Z+3.0);camera.lookAt(contact.position.clone().add(new THREE.Vector3(0,.65,0))); }
      if(view==='POSE_SIDE') { camera.position.set(8.2,1.05,ENCOUNTER_Z+2.7);camera.lookAt(contact.position.clone().add(new THREE.Vector3(0,.60,0))); }
      if(view==='GARDEN') { camera.position.set(10.8,1.55,ENCOUNTER_Z+2.8);camera.lookAt(contact.position.clone().add(new THREE.Vector3(0,.7,0))); }
      if(view==='CLOSE') { camera.position.set(5.8,1.55,ENCOUNTER_Z+2.7);camera.lookAt(contact.position.clone().add(new THREE.Vector3(0,.8,0))); }
      sensorThermal=view!=='VISIBLE';el.sensor.hidden=true;
      camera.fov=60;camera.updateProjectionMatrix();
      return this.npcSnapshot();
    },
    npcSnapshot() {
      contact.updateMatrixWorld(true);
      const bounds=new THREE.Box3();let triangles=0,bones=0;
      contact.traverse(mesh=>{
        if(mesh.isBone) bones++;
        if(!mesh.isSkinnedMesh)return;
        mesh.skeleton.update();triangles+=(mesh.geometry.index?mesh.geometry.index.count:mesh.geometry.attributes.position.count)/3;
        for(let i=0;i<mesh.geometry.attributes.position.count;i++)bounds.expandByPoint(mesh.boneTransform(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
      });
      return {exposedPtz:exposedPersonSamples(ptzOrigin()).length,exposedDriver:exposedPersonSamples(operatorEye.getWorldPosition(new THREE.Vector3())).length,loaded:npcLoaded,visible:contact.visible,patrolElapsed,state:npcState,time:npcTime,position:contact.position.toArray(),min:bounds.min.toArray(),max:bounds.max.toArray(),clips:Object.keys(npcActions),bones,triangles,sensorThermal,vehicle:vehicle.position.toArray(),vehicleSpeed,head:npcHead?.quaternion.toArray(),headBase:npcHeadBase?.toArray(),scanAngle,scanElapsed,holding:ptzHolding(),sensorPosition:sensorCamera.position.toArray(),sensorDirection:sensorCamera.getWorldDirection(new THREE.Vector3()).toArray(),sensorTarget:ptzTarget().toArray(),detectionEvidence};
    },
    pause: toggleDebugPause,
    setView(view) { debugCameraView = view; },
    showHelpers(show) { debugHelpersVisible = Boolean(show); updateDebugVisualization(); },
    activate: activateVehicleEntry,
    placeOfficer(localPosition) {
      if (!debugEntry) return false;
      operator.position.copy(vehiclePoint(localPosition));
      if(!debugPaused && !systemsTour?.active && selectedScenario==="patrol" && state===STATES.VEHICLE_FIRST_PERSON) {
      if(automaticPatrolAt===null)automaticPatrolAt=now+1000;
      if(now>=automaticPatrolAt){automaticPatrolAt=null;beginPatrol();}
    } else automaticPatrolAt=null;
    updateEntryPrompt();
      return true;
    },
    skinBounds() {
      if (!debugEntry) return null;
      operator.updateMatrixWorld(true);
      const bounds = new THREE.Box3();
      operator.traverse(mesh => {
        if (!mesh.isSkinnedMesh) return;
        for (let i=0;i<mesh.geometry.attributes.position.count;i++) {
          bounds.expandByPoint(mesh.boneTransform(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
        }
      });
      return {min:bounds.min.toArray(),max:bounds.max.toArray()};
    },
    cameraTrace(from, to) {
      if (!debugEntry) return null;
      vehicle.updateMatrixWorld(true);
      const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
      const distance = start.distanceTo(end);
      if (distance < 1e-8) return [];
      const ray = new THREE.Raycaster(start,end.clone().sub(start).normalize(),0,distance);
      const hits = ray.intersectObject(cockpit,true);
      ray.set(end,start.clone().sub(end).normalize());
      return hits.concat(ray.intersectObject(cockpit,true)).filter(hit => hit.object.isMesh && !debugVisuals.includes(hit.object)).map(hit => ({name:hit.object.name,distance:hit.distance,point:hit.point.toArray()}));
    },
    eligibleAt(position) { return inDriverEntryArea(new THREE.Vector3(...position)); },
    seekEntry(progress) {
      if (!debugEntry || state !== STATES.VEHICLE_ENTRY_TRANSITION) return false;
      toggleDebugPause(false);
      const elapsed = THREE.MathUtils.clamp(progress,0,.999999)*ENTRY_SECONDS;
      stateStarted = performance.now()-elapsed*1000;
      updateIntro(performance.now());
      toggleDebugPause(true);
      return true;
    },
    sample(stage, progress) {
      if (!debugEntry || !officerLoaded || !cockpit) return false;
      const target = STATES[stage] || stage;
      if (![STATES.EXTERIOR_THIRD_PERSON,STATES.VEHICLE_ENTRY_AVAILABLE,STATES.VEHICLE_ENTRY_TRANSITION,STATES.VEHICLE_FIRST_PERSON].includes(target)) return false;
      toggleDebugPause(false);
      operatorMixer.stopAllAction();
      activeOperatorAction = null;
      lastContactTargets = {};
      ready();
      beginIntro();
      const duration = walkPlan.duration;
      const end = target === STATES.EXTERIOR_THIRD_PERSON ? duration*THREE.MathUtils.clamp(progress,0,.999999):duration;
      const steps = Math.max(1,Math.ceil(end*60));
      for(let i=1;i<=steps;i++) {
        operatorMixer.update(end/steps);
        updateIntro(stateStarted+end*i/steps*1000);
      }
      if (target !== STATES.EXTERIOR_THIRD_PERSON) {
        operatorMixer.update(.3);
        if (target !== STATES.VEHICLE_ENTRY_AVAILABLE) {
          activateVehicleEntry();
          updateIntro(stateStarted+(target === STATES.VEHICLE_FIRST_PERSON ? ENTRY_SECONDS:ENTRY_SECONDS*THREE.MathUtils.clamp(progress,0,.999999))*1000);
        }
      }
      stateStarted = performance.now()-(target === STATES.EXTERIOR_THIRD_PERSON ? end:target === STATES.VEHICLE_ENTRY_TRANSITION ? progress*ENTRY_SECONDS:0)*1000;
      toggleDebugPause(true);
      return this.snapshot();
    },
    snapshot() {
      operator.updateMatrixWorld(true);
      vehicle.updateMatrixWorld(true);
      const position = object => object ? object.getWorldPosition(new THREE.Vector3()).toArray() : null;
      return {
        assets: ASSETS,
        narration: { history:narrationHistory,busy:narrationBusy,queued:narrationQueue.length,context: narrationContext?.state, cached: narrationBuffers.size, played: narrationPlayed, playing: Boolean(narrationSource), error: narrationError },
        camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), eye: operatorEye ? position(operatorEye):null },
        entry: { eligible: inDriverEntryArea(), promptVisible: !el.entryPrompt.hidden, prompt: el.entryButton.textContent, triggerCount: entryTriggerCount, fade: Number(el.entryFade.style.opacity || 0) },
        contacts: lastContactTargets,
        elapsed: ((debugPaused ? debugPausedAt : performance.now()) - stateStarted) / 1000,
        quaternion: operator.quaternion.toArray(),
        bones: Object.fromEntries(Object.entries(rigBones).map(([name, bone]) => [name, position(bone)])),
        targets: Object.fromEntries(Object.entries(interactionTargets).map(([name, target]) => [name, position(target)])),
        door: entryDoor ? {
          name: entryDoor.name,
          angle: entryDoor.rotation.y,
          pivot: position(entryDoor),
          panel: position(cockpit.getObjectByName("DriverDoor")),
          handleParent: interactionTargets.driverDoorHandle ? interactionTargets.driverDoorHandle.parent.name : null
        } : null,
        state,
        paused: debugPaused,
        view: debugCameraView,
        controller: Object.assign({}, characterController),
        root: operator.position.toArray(),
        visible: operator.visible,
        targetErrorMeters: {
          pelvis: rigBones.hip ? rigBones.hip.getWorldPosition(new THREE.Vector3()).distanceTo(targetPosition("driverSeatPelvis", operator.position)) : null,
          leftFoot: rigBones.leftFoot ? rigBones.leftFoot.getWorldPosition(new THREE.Vector3()).distanceTo(targetPosition("driverFootwellLeft", operator.position)) : null,
          rightFoot: rigBones.rightFoot ? rigBones.rightFoot.getWorldPosition(new THREE.Vector3()).distanceTo(targetPosition("driverFootwellRight", operator.position)) : null,
          leftHand: rigBones.leftHand ? rigBones.leftHand.getWorldPosition(new THREE.Vector3()).distanceTo(targetPosition("steeringWheelLeftHand", operator.position)) : null,
          rightHand: rigBones.rightHand ? rigBones.rightHand.getWorldPosition(new THREE.Vector3()).distanceTo(targetPosition("steeringWheelRightHand", operator.position)) : null,
          doorHandle: rigBones.rightHand ? rigBones.rightHand.getWorldPosition(new THREE.Vector3()).distanceTo(targetPosition("driverDoorHandle", operator.position)) : null
        }
      };
    }
  };

  function resolveWalkCapsule(nextPosition) {
    const resolved = nextPosition.clone();
    if (characterController.groundCollision) resolved.y = Math.max(0, resolved.y);
    if (!characterController.vehicleCollision || !vehicleCollisionBox) return resolved;
    const radius = characterController.radius;
    const withinLongitudinal = resolved.z > vehicleCollisionBox.min.z - radius && resolved.z < vehicleCollisionBox.max.z + radius;
    const withinLateral = resolved.x > vehicleCollisionBox.min.x - radius && resolved.x < vehicleCollisionBox.max.x + radius;
    if (withinLongitudinal && withinLateral) {
      resolved.x = entrySide > 0
        ? vehicleCollisionBox.max.x + radius
        : vehicleCollisionBox.min.x - radius;
    }
    return resolved;
  }

  function phaseEase(value) {
    return THREE.MathUtils.smootherstep(THREE.MathUtils.clamp(value, 0, 1), 0, 1);
  }

  function facingQuaternion(from, toward) {
    const helper = new THREE.Object3D();
    helper.position.copy(from);
    const levelTarget = toward.clone();
    levelTarget.y = from.y;
    helper.lookAt(levelTarget);
    // Imported rig forward is +Z (verified from eye/head landmarks).
    return helper.quaternion.clone();
  }

  function updateIntro(now) {
    const t = (now-stateStarted)/1000;
    if (state === STATES.EXTERIOR_THIRD_PERSON) {
      const u = Math.min(t/walkPlan.duration,1);
      operator.position.copy(resolveWalkCapsule(new THREE.Vector3().lerpVectors(walkPlan.start,walkPlan.end,u)));
      operator.quaternion.copy(facingQuaternion(walkPlan.start,walkPlan.end));
      applyWalkContacts(u);
      const cameraOffset = new THREE.Vector3(-3.0,2.0,3.3);
      // Keep the whole officer in view, including portrait phone layouts.
      if (camera.aspect < 1) cameraOffset.multiplyScalar(1.35);
      camera.position.copy(operator.position).add(cameraOffset);
      camera.lookAt(operator.position.clone().add(new THREE.Vector3(.35,1,0)));
      if (u >= 1) {
        playOperatorAction('Idle',true,.2);
        setState(STATES.VEHICLE_ENTRY_AVAILABLE);
        if(!debugPaused && !systemsTour?.active && selectedScenario==="patrol" && state===STATES.VEHICLE_FIRST_PERSON) {
      if(automaticPatrolAt===null)automaticPatrolAt=now+1000;
      if(now>=automaticPatrolAt){automaticPatrolAt=null;beginPatrol();}
    } else automaticPatrolAt=null;
    updateEntryPrompt();
      }
    } else if (state === STATES.VEHICLE_ENTRY_TRANSITION) {
      // Closed-door cut: hide relocation completely; no fabricated exterior body entry.
      el.entryFade.style.opacity=t<.20?String(phaseEase(t/.20)):t<.9?'1':String(1-phaseEase((t-.9)/.55));
      if(t>=.20 && operatorEye){operatorEye.getWorldPosition(camera.position);camera.rotation.set(pitch,yaw,0,'YXZ');}
      if (t >= ENTRY_SECONDS) enterOperatorMode();
    }
  }

  function updateSeatedHead() {
    if(!seatedRootLocal)return;
    for(const key of ['neck','head'])if(rigBones[key] && seatedHeadRest[key])rigBones[key].quaternion.copy(seatedHeadRest[key]);
    operator.updateMatrixWorld(true);
    for(const [key,weight] of [['neck',.35],['head',.65]]) {
      const bone=rigBones[key];if(!bone || !seatedHeadRest[key])continue;
      const turn=new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.clamp(pitch,-.35,.25)*weight,THREE.MathUtils.clamp(yaw,-1.05,1.05)*weight,0,'YXZ'));
      const desired=turn.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
      bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired));
      bone.updateMatrixWorld(true);
    }
  }

  let observationFraming=0, operatorCameraStamp=0;
  function updateOperatorCamera(now) {
    if(systemsTour?.active)return;
    if (!operatorEye) return;
    const stamp=performance.now(), cameraDt=operatorCameraStamp?Math.min((stamp-operatorCameraStamp)/1000,.1):0;
    operatorCameraStamp=stamp;
    const observing=selectedScenario==='patrol' && observationPhase==='OBSERVING' && vehicleSpeed<.01 && !clipMonitorAttention && !expandedDialog.open && patrolElapsed>=manualLookUntil && !pointerDown;
    observationFraming+=(Number(observing)-observationFraming)*(1-Math.exp(-cameraDt*2));
    // A restrained attention crop, from the actual seated eye. No camera teleport,
    // push through the glass, or magnification of the sensor target itself.
    const baseFov=70-12*observationFraming;
    const seatedFov=!exteriorView && camera.aspect<1 ? Math.min(100,THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov/2))/camera.aspect))) : exteriorView?70:baseFov;
    if(camera.fov!==seatedFov){camera.fov=seatedFov;camera.updateProjectionMatrix();}
    operator.visible=exteriorView && !!seatedRootLocal;
    if(seatedRootLocal) {operator.position.copy(vehiclePoint(seatedRootLocal.toArray()));operator.updateMatrixWorld(true);updateSeatedHead();}
    if(exteriorView) {
      const stamp=performance.now(),dt=exteriorCameraTime?Math.min((stamp-exteriorCameraTime)/1000,.1):0;
      exteriorCameraTime=stamp;
      const halfFov=THREE.MathUtils.degToRad(camera.fov/2);
      const fitAngle=Math.min(halfFov,Math.atan(Math.tan(halfFov)*camera.aspect));
      const vehicleCenter=vehicle.localToWorld(new THREE.Vector3(0,1.15,0));
      if(exteriorCameraReady){const motion=vehicleCenter.clone().sub(exteriorLastVehicle);camera.position.add(motion);exteriorFocus.add(motion);}
      exteriorLastVehicle.copy(vehicleCenter);
      const encounter=!exteriorManual && ['STOPPING','OBSERVING'].includes(observationPhase) && contact.visible;
      const target=vehicleCenter.clone();
      let distance=exteriorManual?exteriorManualDistance:3.1/Math.sin(fitAngle);
      const followYaw=departureElapsed!==null && !exteriorManual?Math.PI-.5:exteriorYaw;
      let direction=new THREE.Vector3(Math.sin(followYaw)*Math.cos(exteriorElevation),Math.sin(exteriorElevation),-Math.cos(followYaw)*Math.cos(exteriorElevation));
      if(encounter) {
        const person=contact.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,.85,0));
        target.lerp(person,.5);
        const forward=new THREE.Vector3(0,0,-1).applyQuaternion(vehicle.quaternion);
        const right=new THREE.Vector3(1,0,0).applyQuaternion(vehicle.quaternion);
        const side=Math.sign(person.clone().sub(vehicleCenter).dot(right))||1;
        // Reveal from the open garden side after stopping; retain the road-side view during braking.
        const reveal=observationPhase==='OBSERVING';
        direction=right.multiplyScalar(reveal?side:-side).addScaledVector(forward,reveal?-.45:.28);direction.y=.38;direction.normalize();
        const viewRight=new THREE.Vector3(0,1,0).cross(direction).normalize(),viewUp=direction.clone().cross(viewRight);
        const points=[];
        for(const x of [-1.15,1.15])for(const y of [0,2.7])for(const z of [-2.7,2.7])points.push(vehicle.localToWorld(new THREE.Vector3(x,y,z)));
        for(const x of [-.5,.5])for(const y of [-.85,.85])points.push(person.clone().add(new THREE.Vector3(x,y,0)));
        distance=4.5;
        for(const point of points){const d=point.sub(target),depth=d.dot(direction);distance=Math.max(distance,depth+Math.abs(d.dot(viewRight))/(Math.tan(halfFov)*camera.aspect)*1.18,depth+Math.abs(d.dot(viewUp))/Math.tan(halfFov)*1.18);}

      }
      const desired=target.clone().addScaledVector(direction,distance);
      if(!exteriorCameraReady){camera.position.copy(desired);exteriorFocus.copy(target);exteriorCameraReady=true;}
      else {const blend=1-Math.exp(-dt*(exteriorManual?7:1.4));camera.position.lerp(desired,blend);exteriorFocus.lerp(target,blend);}
      camera.lookAt(exteriorFocus);
      return;
    }
    exteriorCameraReady=false;
    const pos = new THREE.Vector3();
    operatorEye.getWorldPosition(pos);
    // Rigid seat mount: no walking-style bob or lateral head sway.
    camera.position.copy(pos);
    camera.rotation.order = "YXZ";
    const portraitRest=camera.aspect<1 && observationPhase==='NONE' && !expandedDialog.open && !clipMonitorAttention && patrolElapsed>=manualLookUntil;
    camera.rotation.y = yaw+(portraitRest?-.18:0);
    camera.rotation.x = pitch;
    camera.rotation.z = 0;
  }

  function updateDriverAttention(dt) {
    if(!operatorEye || patrolElapsed<manualLookUntil || pointerDown)return;
    let targetYaw=null,targetPitch=-.10;
    if((expandedDialog.open || clipMonitorAttention) && touchscreenSurface) {
      screenAttention=true;
      const offset=touchscreenSurface.getWorldPosition(new THREE.Vector3()).sub(operatorEye.getWorldPosition(new THREE.Vector3()));
      targetYaw=Math.atan2(-offset.x,-offset.z);
      targetPitch=Math.atan2(offset.y,Math.hypot(offset.x,offset.z));
    } else if(observationPhase==='OBSERVING' || ((observationPhase==='STOPPING' || officerSlowPending) && approachTracking)) {
      const offset=driverObservationTarget().sub(operatorEye.getWorldPosition(new THREE.Vector3()));
      targetYaw=Math.atan2(-offset.x,-offset.z);
      targetPitch=Math.atan2(offset.y,Math.hypot(offset.x,offset.z));
    } else if(['STOPPING','RESUMING'].includes(observationPhase) || screenAttention){targetYaw=-.22;if(Math.abs(yaw+.22)<.01)screenAttention=false;}
    if(targetYaw===null)return;
    targetYaw=THREE.MathUtils.clamp(targetYaw,-1.05,1.05);
    targetPitch=THREE.MathUtils.clamp(targetPitch,-.5,.35);
    const step=1-Math.exp(-dt*3);
    yaw+=THREE.MathUtils.clamp((targetYaw-yaw)*step,-dt*.65,dt*.65);
    pitch+=THREE.MathUtils.clamp((targetPitch-pitch)*step,-dt*.45,dt*.45);
  }

  function opaqueSightline(eye,target) {
    return !TactixSightline.blocked(cockpit,eye,target) && !new THREE.Raycaster(eye,target.clone().sub(eye).normalize(),.02,eye.distanceTo(target)-.1).intersectObject(vegetation,true).length;
  }

  function planObservationStop() {
    // Plan only after sensor acquisition, along the current straight patrol route.
    vehicle.updateMatrixWorld(true);contact.updateMatrixWorld(true);vegetation.updateMatrixWorld(true);
    const start=vehicle.position.clone(),eye=operatorEye.getWorldPosition(new THREE.Vector3());
    const forward=new THREE.Vector3(0,0,-1).applyQuaternion(vehicle.quaternion);
    const right=new THREE.Vector3(1,0,0).applyQuaternion(vehicle.quaternion);
    const target=contact.getWorldPosition(new THREE.Vector3());
    const offset=target.clone().sub(eye),ahead=offset.dot(forward),lateral=Math.abs(offset.dot(right));
    const bounds=new THREE.Box3().setFromObject(cockpit);
    const frontClearance=Math.max(.5,eye.z-bounds.min.z+.5);
    const brakingDistance=vehicleSpeed*vehicleSpeed/(2*1.1)+vehicleSpeed*.3;
    let best=null;
    try {
      for(const degrees of [45,50,55,60,40,35,30,25,20]) {
        const gap=Math.max(frontClearance,lateral/Math.tan(THREE.MathUtils.degToRad(degrees)));
        const travel=ahead-gap;
        if(travel<brakingDistance || gap<=0)continue;
        vehicle.position.copy(start).addScaledVector(forward,travel);vehicle.updateMatrixWorld(true);
        const candidateEye=operatorEye.getWorldPosition(new THREE.Vector3());
        const visibleSamples=personSamples().filter(p=>opaqueSightline(candidateEye,p)).length;
        if(visibleSamples<1)continue;
        const score=Math.abs(degrees-50)+(3-visibleSamples)*12;
        if(!best || score<best.score)best={stop:vehicle.position.clone(),forward:forward.clone(),target:target.clone(),ahead:gap,bearing:degrees,visibleSamples,brakingDistance,score,fallback:false};
      }
    } finally {vehicle.position.copy(start);vehicle.updateMatrixWorld(true);}
    // No clear reachable view: brake on the existing route, without chasing past the contact.
    return best || {stop:start.clone().addScaledVector(forward,brakingDistance),forward,target,ahead:ahead-brakingDistance,bearing:null,visibleSamples:0,brakingDistance,fallback:true};
  }

  function remainingObservationDistance() {
    return observationPlan?Math.max(0,observationPlan.stop.clone().sub(vehicle.position).dot(observationPlan.forward)):0;
  }

  function personSightlineClear() {
    if(!operatorEye || !cockpit)return false;
    if(patrolElapsed>=nextSightCheck) {
      nextSightCheck=patrolElapsed+.15;
      vehicle.updateMatrixWorld(true);vegetation.updateMatrixWorld(true);
      const eye=operatorEye.getWorldPosition(new THREE.Vector3());
      driverSightClear=personSamples().some(p=>opaqueSightline(eye,p));
    }
    return driverSightClear;
  }

  function driverObservationTarget() {
    // Frame the hiding place as well as the exposed head. Keep using the live
    // skeleton so changes in pose or stopping position cannot detach the gaze.
    return ptzTarget().add(new THREE.Vector3(0,-.18,0));
  }

  function settledPersonSightline() {
    if(!operatorEye || vehicleSpeed>.01)return false;
    const delta=driverObservationTarget().sub(operatorEye.getWorldPosition(new THREE.Vector3()));
    const aimYaw=THREE.MathUtils.clamp(Math.atan2(-delta.x,-delta.z),-1.05,1.05);
    const aimPitch=THREE.MathUtils.clamp(Math.atan2(delta.y,Math.hypot(delta.x,delta.z)),-.5,.35);
    return Math.abs(yaw-aimYaw)<=.06 && Math.abs(pitch-aimPitch)<=.07 ;
  }

  function startPatrolFinale(){
    if(patrolFinaleTime!==null)return;
    patrolFinaleTime=0;vehicleSpeed=driverSpeedTarget=0;postSendObservation=false;expandedDialog.close();
    exteriorView=true;exteriorManual=false;manualPtz=false;setState(STATES.PATROL_FINALE);
    el.sentry.textContent='REVIEW COMPLETE';el.lookHint.hidden=true;
    updatePatrolFinale(0);
  }
  function updatePatrolFinale(dt){
    // A low garden-side arc reveals the concealed person and the PTZ's sightline.
    // Keep the road-side hedge behind the person rather than orbiting through it.
    patrolFinaleTime=Math.min(16,patrolFinaleTime+dt);
    if(patrolFinaleTime<.35){el.entryFade.style.opacity=String(phaseEase(patrolFinaleTime/.35));return;}
    operator.visible=true;
    const progress=phaseEase(THREE.MathUtils.clamp((patrolFinaleTime-4.5)/10.5,0,1));
    const person=contact.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,.85,0));
    const focus=vehicle.localToWorld(new THREE.Vector3(0,1.25,0)).lerp(person,.5);
    const portrait=camera.aspect<.9;
    camera.fov=portrait?58:48;camera.updateProjectionMatrix();
    const angle=portrait?THREE.MathUtils.lerp(-.58,-.34,progress):THREE.MathUtils.lerp(.14,.70,progress);
    const direction=new THREE.Vector3(Math.cos(angle),.27,Math.sin(angle)).normalize();
    const right=new THREE.Vector3(0,1,0).cross(direction).normalize();
    const up=direction.clone().cross(right);
    const half=THREE.MathUtils.degToRad(camera.fov/2),points=[];
    for(const x of [-1.15,1.15])for(const y of [0,2.85])for(const z of [-2.8,2.8])points.push(vehicle.localToWorld(new THREE.Vector3(x,y,z)));
    for(const x of [-.55,.55])for(const y of [-.85,.85])points.push(person.clone().add(new THREE.Vector3(x,y,0)));
    let distance=6;
    // Fit actual subjects, not the entire hedge's bounding sphere; a modest dolly-in
    // still leaves margin for the vehicle, roof hardware and head/feet on phones.
    const margin=THREE.MathUtils.lerp(1.24,1.13,progress);
    for(const point of points){const d=point.sub(focus),depth=d.dot(direction);distance=Math.max(distance,depth+Math.abs(d.dot(right))*margin/(Math.tan(half)*camera.aspect),depth+Math.abs(d.dot(up))*margin/Math.tan(half));}
    const overview=focus.clone().addScaledVector(direction,distance);
    // Establish the optical head and its aim before revealing the full relationship.
    // This point is above/outside the roof edge on the target-facing side.
    const roofFocus=ptzOrigin();
    const closePosition=roofFocus.clone().add(new THREE.Vector3(portrait?.95:1.05,.43,portrait?-.95:-1.05));
    const reveal=phaseEase(THREE.MathUtils.clamp((patrolFinaleTime-2.85)/1.65,0,1));
    camera.position.copy(closePosition).lerp(overview,reveal);
    camera.lookAt(roofFocus.clone().lerp(focus,reveal));
    el.entryFade.style.opacity=String(patrolFinaleTime<.7?1-phaseEase((patrolFinaleTime-.35)/.35):phaseEase((patrolFinaleTime-15.5)/.5));
    if(patrolFinaleTime>=16)completeScenario();
  }

  function completeScenario() {
    setState(STATES.COMPLETE);vehicleSpeed=0;driverSpeedTarget=0;
    expandedDialog.close();el.entryFade.style.opacity='0';
    const summary=document.getElementById('completionSummary');summary.replaceChildren();
    const lines=['Person detected and observed',patrolFinaleTime!==null?'Exterior review complete · vehicle remained stopped':'Patrol resumed · PTZ scanning'];
    if(eventClip.blob)lines.splice(1,0,'Activity clip recorded');
    lines.push(eventClip.status==='SIMULATED_SEND'?'Clip sent to command center — simulated':eventClip.status==='KEPT_LOCAL'?'Clip kept locally in this session':'Clip not transmitted');
    for(const text of lines){const item=document.createElement('li');item.textContent=text;summary.appendChild(item);}
    document.getElementById('viewRecordedClip').disabled=!eventClip.url;
    document.getElementById('completionPanel').hidden=false;
    document.getElementById('replayScenario').focus();
  }
  document.getElementById('replayScenario').addEventListener('click',()=>{if(selectedScenario==='interception')sessionStorage.setItem('tactixReplay','interception');else if(systemsTourSelected)sessionStorage.setItem('tactixReplay','systems-tour');location.reload();});
  document.addEventListener('visibilitychange',()=>window.TactixLaunchAudio?.setPaused(document.hidden));
  document.getElementById('exitScenario').addEventListener('click',async()=>{
    window.TactixLaunchAudio?.stop();
    // Return to the start screen and leave immersive mode; never try to close a user-owned tab.
    if(document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch (_) { /* Navigation still exits the scenario. */ }
    }
    location.reload();
  });
  document.getElementById('viewRecordedClip').addEventListener('click',()=>{
    if(!eventClip.url)return;
    const player=document.getElementById('recordedClipPlayer');player.src=eventClip.url;
    document.getElementById('recordedClipDialog').showModal();player.play().catch(()=>{});
  });
  document.getElementById('closeRecordedClip').addEventListener('click',()=>document.getElementById('recordedClipDialog').close());
  document.getElementById('recordedClipDialog').addEventListener('close',()=>document.getElementById('recordedClipPlayer').pause());

  function updatePatrolVehicle(dt) {
    if(selectedScenario==='interception'){updateAirContact(dt);return;}
    if(![STATES.PATROL,STATES.CONTACT,STATES.INSPECTING,STATES.TRACKING,STATES.DISMISSED].includes(state)) return;
    patrolElapsed+=dt;
    if(departureElapsed!==null){
      departureElapsed+=dt;
      if(departureElapsed>6)el.entryFade.style.opacity=String(phaseEase((departureElapsed-6)/1.2));
      if(departureElapsed>=7.2){completeScenario();return;}
    }
    contact.visible=true;
    if(observationPlan && (officerSlowPending || observationPhase==='STOPPING') && contact.position.distanceTo(observationPlan.target)>.5)observationPlan=planObservationStop();
    if(officerSlowPending && patrolElapsed>=officerSlowAt) {
      officerSlowPending=false;officerSlowAt=null;driverSpeedTarget=OBSERVATION_SPEED;observationPhase="STOPPING";nextSightCheck=0;
      setMessage('Officer slowing to a stop to observe the person.',false);
    }
    if(observationPhase==='STOPPING' && vehicleSpeed<.01) {
      observationPhase='OBSERVING';driverSpeedTarget=0;personObservationTime=0;driverSightClear=false;nextSightCheck=0;
      setMessage('Stopped to observe the person. Select Proceed with Patrol when ready.',false);
    }
    if(observationPhase==='RESUMING') {
      resumeLookTime+=dt;
      if(resumeLookTime>=1.5 && Math.abs(yaw+.22)<.04){
        observationPhase='NONE';driverSpeedTarget=PATROL_SPEED;departureElapsed=0;
        manualPtz=false;scanAngle=THREE.MathUtils.euclideanModulo(-(ptzPan?.rotation.y||0),Math.PI*2);
        setState(STATES.PATROL);el.sentry.textContent='360° SCAN';el.trackState.textContent='OBSERVATION COMPLETE';
        sensorVisible=true;el.sensorTarget.textContent='360° SCAN';
        setMessage('Patrol resumed. Sentry One PTZ scanning. Recorded clip retained.',false);
      }
    }
    if((observationPhase==='STOPPING' || officerSlowPending) && !approachTracking && vehicleSpeed<=2 && remainingObservationDistance()<=Math.max(3,vehicleSpeed*4) && personSightlineClear())approachTracking=true;
    updateDriverAttention(dt);
    if(observationPhase==='OBSERVING' && !expandedDialog.open && !clipMonitorAttention && settledPersonSightline())personObservationTime+=dt;
    if(postSendObservation && personObservationTime>=5)proceedPatrol();
    if(eventClip.status==='RECORDED' && (personObservationTime>=6 || observationPhase==='RESUMING' || state===STATES.DISMISSED)) {
      eventClip.status='READY';eventClip.decisionElapsed=0;clipMonitorAttention=observationPhase==='OBSERVING';manualLookUntil=0;
      setMessage('Activity clip recorded. Send the clip to the command center?',true);
    }
    // Give the operator four visible seconds after narration finishes.
    if(eventClip.status==='READY' && !narrationBusy && !narrationQueue.length && !document.hidden){
      eventClip.decisionElapsed=(eventClip.decisionElapsed||0)+dt;
      if(eventClip.decisionElapsed>=4)keepClipLocal(true);
    }
    const remaining=remainingObservationDistance();
    const brakingForContact=officerSlowPending || observationPhase==='STOPPING';
    const targetSpeed=brakingForContact?Math.min(observationPhase==='STOPPING'?OBSERVATION_SPEED:driverSpeedTarget,Math.sqrt(2*1.1*remaining)):driverSpeedTarget;
    const previousSpeed=vehicleSpeed;
    vehicleSpeed=THREE.MathUtils.clamp(targetSpeed,Math.max(0,vehicleSpeed-1.1*dt),vehicleSpeed+1.4*dt);
    let travel=(previousSpeed+vehicleSpeed)*.5*dt;
    if(brakingForContact && travel>=remaining){travel=remaining;vehicleSpeed=0;}
    vehicle.position.z-=travel;
    wheelTravel+=travel;
    rollingWheels.forEach(({pivot,radius})=>{pivot.rotation.x=-wheelTravel/radius;});

    el.speed.textContent=Math.round(vehicleSpeed*2.236936).toString()+' mph';
    el.driveMode.textContent=driverSpeedTarget===0?(vehicleSpeed<.01?'STOPPED · OBSERVING':'DRIVER BRAKING'):driverSpeedTarget<PATROL_SPEED?'DRIVER SLOW':'DRIVER PATROL';
  }

  function ptzOrigin() {
    vehicle.updateMatrixWorld(true);
    return ptzOptical ? ptzOptical.getWorldPosition(new THREE.Vector3()) : ptzMount ? ptzMount.getWorldPosition(new THREE.Vector3()) : vehicle.position.clone().add(new THREE.Vector3(0,2.1,-.2));
  }

  function personSamples() {
    contact.updateMatrixWorld(true);
    const samples=[];
    contact.traverse(bone=>{
      if(bone.isBone && /(?:Head|LeftShoulder|RightShoulder|LeftArm|RightArm)$/.test(bone.name))
        samples.push(bone.getWorldPosition(new THREE.Vector3()));
    });
    return samples;
  }
  function exposedPersonSamples(origin) {
    vegetation.updateMatrixWorld(true);
    return personSamples().filter(point=>{
      const delta=point.clone().sub(origin);
      return !new THREE.Raycaster(origin,delta.clone().normalize(),0,Math.max(0,delta.length()-.03)).intersectObject(vegetation,true).length;
    });
  }
  function ptzTarget() {
    const points=personSamples();
    return points.length ? points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).multiplyScalar(1/points.length) : contact.position.clone().add(new THREE.Vector3(0,1.10,0));
  }

  function ptzHolding() {
    return !manualPtz && [STATES.TRACKING,STATES.CONTACT,STATES.INSPECTING,STATES.PATROL_FINALE].includes(state);
  }

  function updatePtzScan(dt) {
    if(selectedScenario==='interception')return;
    if(![STATES.PATROL,STATES.CONTACT,STATES.INSPECTING,STATES.TRACKING,STATES.DISMISSED].includes(state)) return;
    if(!manualPtz && !ptzHolding()) { scanElapsed+=dt;scanAngle=(scanAngle+dt*SCAN_RATE)%(Math.PI*2); }
    if(state!==STATES.PATROL || contactTriggered || !npcLoaded || patrolElapsed<ENCOUNTER_DELAY) return;
    const origin=ptzOrigin(),target=ptzTarget(),offset=target.clone().sub(origin);
    const range=offset.length();
    const bearing=Math.atan2(offset.x,-offset.z);
    const aimAngle=manualPtz?manualPan:scanAngle;
    const error=Math.atan2(Math.sin(bearing-aimAngle),Math.cos(bearing-aimAngle));
    const elevationError=manualPtz?Math.atan2(offset.y,Math.hypot(offset.x,offset.z))-manualTilt:0;
    // Acquire only an exposed upper-body sample inside the live scan cone.
    const exposed=exposedPersonSamples(origin);
    const occluded=exposed.length===0;
    if(range<=60 && Math.abs(error)<=THREE.MathUtils.degToRad(14) && Math.abs(elevationError)<=THREE.MathUtils.degToRad(14) && !occluded) {
      detectionEvidence={range,bearing,scanAngle,error,vehicleZ:vehicle.position.z,targetZ:target.z,scanElapsed,occluded,exposedSamples:exposed.length,npcState,npcTime};
      manualPtz=false;showContact();
    }
  }

  function updateSensorCamera() {
    if(selectedScenario==='interception' && aerialContact){
      if(ptzPan && ptzTilt){ptzPan.rotation.y=-air.pan;ptzTilt.rotation.x=air.tilt;roofHardware.updateMatrixWorld(true);}
      const origin=ptzOrigin();sensorCamera.position.copy(origin);sensorCamera.fov=air.fov;
      sensorCamera.lookAt(origin.clone().add(new THREE.Vector3(Math.sin(air.pan)*Math.cos(air.tilt),Math.sin(air.tilt),-Math.cos(air.pan)*Math.cos(air.tilt))));
      sensorCamera.updateProjectionMatrix();return;
    }
    const target=selectedScenario==='interception' && aerialContact?aerialContact.position.clone():ptzHolding()?ptzTarget():null;
    if(ptzPan && ptzTilt) {
      if(target) {
        for(let i=0;i<3;i++) {
          const delta=target.clone().sub(ptzOrigin());
          ptzPan.rotation.y=-Math.atan2(delta.x,-delta.z);
          // Display-only operating envelope; not claimed mechanical hard stops.
          ptzTilt.rotation.x=THREE.MathUtils.clamp(Math.atan2(delta.y,Math.hypot(delta.x,delta.z)),-Math.PI/3,Math.PI/3);
          roofHardware.updateMatrixWorld(true);
        }
      } else {
        ptzPan.rotation.y=-(manualPtz?manualPan:scanAngle);ptzTilt.rotation.x=manualPtz?manualTilt:-Math.atan2(1.4,30);roofHardware.updateMatrixWorld(true);
      }
    }
    const origin=ptzOrigin();sensorCamera.position.copy(origin);
    if(target) {
      sensorCamera.fov=THREE.MathUtils.radToDeg(2*Math.atan(1.12/origin.distanceTo(target)));
      sensorCamera.lookAt(target);
    } else {
      sensorCamera.fov=32;
      const pan=manualPtz?manualPan:scanAngle, tilt=manualPtz?manualTilt:-Math.atan2(1.4,30);
      const direction=new THREE.Vector3(Math.sin(pan)*Math.cos(tilt),Math.sin(tilt),-Math.cos(pan)*Math.cos(tilt)).applyQuaternion(vehicle.getWorldQuaternion(new THREE.Quaternion()));
      sensorCamera.lookAt(origin.clone().add(direction));
    }
    sensorCamera.updateProjectionMatrix();
  }

  function resize() {
    const width = el.stage.clientWidth;
    const height = el.stage.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener('resize',resize);
  new ResizeObserver(resize).observe(el.stage);
  const fullscreenButton=document.getElementById('fullscreenButton');
  const mobileView=window.matchMedia('(max-width: 950px)');
  const phoneInput=()=>navigator.maxTouchPoints>0 || window.matchMedia('(pointer: coarse)').matches;
  const orientationHint=document.createElement('aside');orientationHint.className='phone-orientation-hint';orientationHint.hidden=true;
  orientationHint.setAttribute('role','status');orientationHint.innerHTML='<span>For a wider view, rotate your phone sideways.</span><button type="button" aria-label="Dismiss rotation hint">×</button>';
  document.body.append(orientationHint);
  let rotationHintTimer;
  orientationHint.querySelector('button').onclick=()=>{orientationHint.hidden=true;};
  function showRotationHint(){
    if(!phoneInput() || innerWidth>=innerHeight)return;
    orientationHint.hidden=false;clearTimeout(rotationHintTimer);
    rotationHintTimer=setTimeout(()=>{orientationHint.hidden=true;},7000);
  }
  window.addEventListener('resize',()=>{if(innerWidth>=innerHeight)orientationHint.hidden=true;});
  async function preferLandscape(){
    try{await screen.orientation?.lock('landscape');}catch(_){}
    showRotationHint();
  }
  async function enterMobileFullscreen(){
    if(!phoneInput() || !mobileView.matches)return;
    try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen?.({navigationUI:'hide'});}catch(_){}
    await preferLandscape();
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('#enterButton,#systemsTourButton,#interceptionButton') && state===STATES.READY)enterMobileFullscreen();
  },true);
  fullscreenButton.classList.add('fullscreen-suggestion');
  fullscreenButton.addEventListener('click',async()=>{
    try {
      if(document.fullscreenElement)await document.exitFullscreen();
      else if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen({navigationUI:'hide'});if(phoneInput())await preferLandscape();}
      else throw new Error('Fullscreen unavailable');
    } catch(_) {
      const hint=document.getElementById('fullscreenHint');
      hint.textContent='Fullscreen is unavailable in this browser. Try Add to Home screen from the browser menu.';
      hint.hidden=false;setTimeout(()=>{hint.hidden=true;},7000);
    }
  });
  document.addEventListener('fullscreenchange',()=>{
    fullscreenButton.textContent=document.fullscreenElement?'EXIT FULLSCREEN':'FULLSCREEN';fullscreenButton.classList.toggle('fullscreen-suggestion',!document.fullscreenElement);resize();
  });
  resize();

  function renderTrackingOverlay() {
    const ctx=trackContext;ctx.clearRect(0,0,512,288);
    const airMode=selectedScenario==='interception';
    const active=airMode?['ACQUIRING','TRACKING','CONFIRM','BRAKING','LAUNCHING'].includes(air.phase):contact.visible && [STATES.TRACKING,STATES.CONTACT,STATES.INSPECTING,STATES.PATROL_FINALE].includes(state);
    const now=performance.now();let points=[],label='',detail='';
    if(active && airMode && aerialContact) {
      aerialContact.traverse(mesh=>{
        if(!mesh.isMesh)return;
        if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
        const bounds=mesh.geometry.boundingBox;
        for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])points.push(new THREE.Vector3(x,y,z).applyMatrix4(mesh.matrixWorld));
      });
      label='AIR CONTACT 01';detail=air.confirmed?'QUADCOPTER · TRACK ACTIVE':'ACQUIRING';
    } else if(active) {
      // Only visible skeletal samples contribute: never bracket a hidden full body.
      const visible=exposedPersonSamples(sensorCamera.position);
      const right=new THREE.Vector3(1,0,0).applyQuaternion(sensorCamera.quaternion);
      const up=new THREE.Vector3(0,1,0).applyQuaternion(sensorCamera.quaternion);
      // Head joints sit near the base of the skull, below the visible hood.
      // Include its physical volume instead of centering a tiny box on the joint.
      for(const p of visible)for(const dx of [-.14,.14])for(const dy of [-.06,.23])points.push(p.clone().addScaledVector(right,dx).addScaledVector(up,dy));
      label='PERSON 01';detail=npcState===NPC_STATES.HIDDEN_CROUCH?'CROUCHING / PARTLY CONCEALED':'PERSON · TRACK ACTIVE';
    }
    sensorCamera.updateMatrixWorld(true);
    const projected=points.map(p=>p.project(sensorCamera)).filter(p=>p.z>=-1 && p.z<=1);
    let box=null;
    if(projected.length){
      const left=Math.min(...projected.map(p=>(p.x+1)*256))-4,right=Math.max(...projected.map(p=>(p.x+1)*256))+4;
      const top=Math.min(...projected.map(p=>(1-p.y)*144))-4,bottom=Math.max(...projected.map(p=>(1-p.y)*144))+4;
      if(right>0 && left<512 && bottom>0 && top<288)box=[Math.max(3,left),Math.max(3,top),Math.min(509,right),Math.min(285,bottom)];
    }
    if(box){
      sensorTrack={status:'TRACKING',box,label,lastSeen:now};
      ctx.strokeStyle='#ffcf62';ctx.lineWidth=2;
      const [l,t,r,b]=box,k=Math.min(12,(r-l)/3,(b-t)/3);
      ctx.beginPath();
      for(const [x,y,sx,sy] of [[l,t,1,1],[r,t,-1,1],[l,b,1,-1],[r,b,-1,-1]]){ctx.moveTo(x+sx*k,y);ctx.lineTo(x,y);ctx.lineTo(x,y+sy*k);}
      ctx.stroke();
    } else if(active && sensorTrack.label===label && now-sensorTrack.lastSeen<1800){
      sensorTrack.status='OCCLUDED';sensorTrack.box=null;detail='TRACK OCCLUDED';
    } else {sensorTrack={status:'NONE',box:null,label:'',lastSeen:0};label='';}
    if(label && sensorTrack.status!=='NONE'){
      // Fixed header prevents the label from covering a small exposed head.
      ctx.fillStyle='rgba(5,12,18,.82)';ctx.fillRect(6,6,Math.min(500,Math.max(label.length,detail.length)*7.8+16),40);
      ctx.fillStyle='#ffcf62';ctx.font='bold 14px sans-serif';ctx.fillText(label,12,23);
      ctx.fillStyle='#e3edf1';ctx.font='12px sans-serif';ctx.fillText(detail,12,39);
    }
    trackTexture.needsUpdate=true;
    const clear=renderer.autoClear;renderer.autoClear=false;renderer.render(trackOverlay,sensorScreenCamera);renderer.autoClear=clear;
  }

  function renderSensorView(inset = false) {
    if (!sensorVisible) return;
    if(inset) {
      if(el.sensor.hidden) return;
      const canvasRect=el.canvas.getBoundingClientRect(),rect=el.sensor.getBoundingClientRect();
      renderer.setScissorTest(true);
      renderer.setScissor(rect.left-canvasRect.left,canvasRect.bottom-rect.bottom,rect.width,rect.height);
      renderer.setViewport(rect.left-canvasRect.left,canvasRect.bottom-rect.bottom,rect.width,rect.height);
      renderer.render(sensorScreen,sensorScreenCamera);
      renderer.setScissorTest(false);
      return;
    }
    const changed=[];
    const background=scene.background, fog=scene.fog;
    const vehicleVisible=vehicle.visible;
    vehicle.visible=false; // Roof camera sees beyond its own mount; avoid screen feedback.
    duskSky.visible=!sensorThermal;
    if(sensorThermal) {
      scene.traverse(obj => {
        if(!obj.isMesh || obj===duskSky) return;
        let parent=obj, human=false;
        while(parent) { if(parent===contact) human=true;parent=parent.parent; }
        changed.push([obj,obj.material]);
        obj.material=human?thermalHotMaterial:thermalColdMaterial;
      });
      scene.background=new THREE.Color(0x17212b);scene.fog=new THREE.FogExp2(0x17212b,.003);
    }
    if(!inset) {
      renderer.setRenderTarget(sensorTarget);
      renderer.render(scene,sensorCamera);
      renderTrackingOverlay();
      captureEventFrame();
      renderer.setRenderTarget(null);
    }
    changed.forEach(([obj,material])=>{obj.material=material;});
    scene.background=background;scene.fog=fog;vehicle.visible=vehicleVisible;duskSky.visible=true;
    document.getElementById('sensorTitle').textContent='SENTRY ONE PTZ · '+(sensorThermal?'THERMAL':'VISIBLE');
    const surface=cockpit && cockpit.getObjectByName('DashboardScreenSurface');
    if(surface && !mountedTouchscreen) surface.material.map=sensorTarget.texture;
  }

  function animate(now) {
    requestAnimationFrame(animate);
    const elapsed = document.hidden?0:Math.min(clock.getDelta(), .1);
    if(document.hidden)clock.getDelta();
    const dt = Math.min(elapsed, .05);
    if (operatorMixer && !debugPaused) operatorMixer.update(dt);
    el.clock.textContent = new Date().toLocaleTimeString([], { hour12: false });

    if (!debugPaused && [STATES.EXTERIOR_THIRD_PERSON,STATES.VEHICLE_ENTRY_TRANSITION].includes(state)) {
      updateIntro(now);
    }
    if(!debugPaused && !systemsTour?.active && selectedScenario==="patrol" && state===STATES.VEHICLE_FIRST_PERSON) {
      if(automaticPatrolAt===null)automaticPatrolAt=now+1000;
      if(now>=automaticPatrolAt){automaticPatrolAt=null;beginPatrol();}
    } else automaticPatrolAt=null;
    updateEntryPrompt();
    el.viewToggle.hidden=!seatedStates.includes(state);

    if(!debugPaused) {
      // Consume actual frame time, including slower frames, in small motion steps.
      const steps=Math.max(1,Math.ceil(elapsed/(1/60)));
      for(let i=0;i<steps;i++) { updatePatrolVehicle(elapsed/steps); }
      if(selectedScenario==='patrol' && [STATES.PATROL,STATES.CONTACT,STATES.INSPECTING,STATES.TRACKING].includes(state)) updateNpc(npcTime+elapsed);
      updatePtzScan(elapsed);
    }
    // Both cameras consume the final vehicle and skeleton transforms of this frame.
    scene.updateMatrixWorld(true);
    if(!debugPaused && [STATES.LAUNCH_READY,STATES.VEHICLE_FIRST_PERSON,STATES.PATROL,STATES.CONTACT,STATES.INSPECTING,STATES.TRACKING,STATES.DISMISSED].includes(state)) updateOperatorCamera(now);
    if(!debugPaused && state===STATES.LAUNCHING)updateLaunch(elapsed);
    if(!debugPaused && state===STATES.PATROL_FINALE)updatePatrolFinale(elapsed);
    if(state===STATES.LAUNCHING)el.viewToggle.hidden=true;
    updateDebugVisualization();
    updateDebugCamera();
    updateSensorCamera();
    el.scanReadout.hidden=selectedScenario==='interception' || !exteriorView || !seatedStates.includes(state);
    if(!el.scanReadout.hidden) {
      const degrees=((THREE.MathUtils.radToDeg(-(ptzPan?.rotation.y || 0))%360)+360)%360;
      el.scanArrow.style.transform='rotate('+degrees+'deg)';
      el.scanStatus.textContent=manualPtz?'PTZ MANUAL':ptzHolding()?'PTZ TRACKING PERSON':state===STATES.VEHICLE_FIRST_PERSON?'PTZ STANDBY':'PTZ SCANNING 360°';
      el.scanAngle.textContent=Math.round(degrees)+'° · VEHICLE RELATIVE';
    }
    drawDashDisplays(now);
    renderSensorView();
    renderTouchscreen();
    updateExpandedTouchscreen(now);
    if(systemsTour?.active){systemsTour.update(elapsed);el.viewToggle.hidden=true;el.lookHint.hidden=true;document.getElementById("expandTouchscreen").hidden=true;}
    renderer.setViewport(0, 0, el.stage.clientWidth, el.stage.clientHeight);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);
    // PTZ imagery is displayed on the mounted touchscreen, not a floating popup.
  }

  systemsTour=createSystemsTour({stage:el.stage,camera,
    bounds(index){
      const object=index===2?ptzRig:reconRig;if(!object)return null;
      const box=new THREE.Box3().setFromObject(object),points=[];
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).project(camera));
      return {left:Math.min(...points.map(p=>p.x*.5+.5)),right:Math.max(...points.map(p=>p.x*.5+.5)),top:Math.min(...points.map(p=>-p.y*.5+.5)),bottom:Math.max(...points.map(p=>-p.y*.5+.5))};
    },
    pose(index,cut,anchorOnly=false){
      // Mark the rear upper edge in world metres; the imported display's
      // vertex coordinates are baked, so local unit offsets are not its height.
      const screenBounds=new THREE.Box3().setFromObject(touchscreenSurface);
      const rearAnchor=screenBounds.getCenter(new THREE.Vector3());
      rearAnchor.y=screenBounds.max.y+.022;rearAnchor.z-=.09;
      const anchor=index<2?rearAnchor:index===2?vehiclePoint([0,2.14,-.18]):vehiclePoint([0,2.10,1.35]);
      if(anchorOnly)return anchor;
      const portrait=camera.aspect<1;
      const position=index<2?operatorEye.getWorldPosition(new THREE.Vector3()):vehiclePoint(index===2?[-.95,2.55,-1.15]:[-1.1,2.65,2.5]);
      const look=index<2?touchscreenSurface.getWorldPosition(new THREE.Vector3()):anchor.clone();
      if(portrait)look.y-=index<2?.28:.38;
      if(index>=2 && camera.aspect>1 && el.stage.clientWidth<1000){const right=new THREE.Vector3().subVectors(look,position).cross(camera.up).normalize();look.addScaledVector(right,-.45);}
      camera.position.copy(position);camera.fov=index<2?(portrait?85:60):(portrait?65:50);camera.updateProjectionMatrix();camera.lookAt(look);
      operator.visible=index>=2;
      return anchor;
    },
    example(){sensorVisible=true;sensorThermal=true;},
    finish(){
      exteriorView=false;operator.visible=false;sensorVisible=false;sensorThermal=false;
      automaticPatrolAt=performance.now()+1600;updateOperatorCamera(performance.now());
      el.entryFade.style.opacity='1';setTimeout(()=>{el.entryFade.style.opacity='0';},120);
    }
  });
  loadNpc(() => loadOfficer(loadCockpit));
  requestAnimationFrame(animate);
})();

(function () {
  "use strict";

  const ASSETS = Object.freeze({
    cockpit: "assets/models/bolero_camper_simulator.glb?v=6",
    officer: "assets/models/tactical_officer_rigged.glb?v=5",
    npc: "assets/models/hooded_npc.glb?v=1",
    touchscreen: "assets/models/ptz_touchscreen_clean.glb?v=1",
    ptz: "assets/models/ptz_roof.glb?v=2",
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
  scene.fog = new THREE.FogExp2(0x69627c, 0.006);

  // Camera-relative sky: no translation/parallax, including the independent PTZ.
  // Analytic colours and crescent need no texture downloads or extra render pass.
  const duskSky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        horizon: { value: new THREE.Color(0xf1ad79).convertSRGBToLinear() },
        rose: { value: new THREE.Color(0xaa759c).convertSRGBToLinear() },
        blue: { value: new THREE.Color(0x34588f).convertSRGBToLinear() },
        zenith: { value: new THREE.Color(0x082956).convertSRGBToLinear() },
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
  let roofHardware=null, ptzPan=null, ptzTilt=null, ptzOptical=null, ptzRig=null, interceptorRig=null;
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
  let yaw = .22; // Slight leftward seated glance keeps road and center screen visible.
  let pitch = -0.10;
  const rollingWheels=[];
  let wheelTravel=0;
  let driverSpeedTarget=5;
  let officerSlowAt=null,officerSlowPending=false;
  let clipMonitorAttention=false, clipReturnTimer=null;
  let observationPhase="NONE", resumeLookTime=0, manualLookUntil=0, screenAttention=false;
  let originalSpeedometer=null;
  const eventClip={status:"IDLE",sentAt:null,sendStarted:0,blob:null,url:null,recorder:null,stream:null,started:0,lastFrame:0,timer:null,frames:0,error:null};
  let recordingCanvas=null,recordingContext=null,recordingPixels=null,recordingImage=null;
  let seatedRootLocal=null;
  let exteriorView = false;
  let exteriorYaw = .65, exteriorElevation = .40;
  const seatedStates = [STATES.VEHICLE_FIRST_PERSON,STATES.PATROL,STATES.CONTACT,STATES.INSPECTING,STATES.TRACKING,STATES.DISMISSED];
  let pointerDown = false;
  let lastPointer = { x: 0, y: 0 };
  let introCameraStart = new THREE.Vector3();
  const clock = new THREE.Clock();
  let speechGeneration = 0;
  let narrationContext = null;
  let narrationSource = null;
  const narrationQueue=[];
  let narrationActiveText="";
  let narrationPlayed = 0;
  let narrationError = null;
  const narrationBuffers = new Map();
  const narrationManifest = fetch('assets/audio/narration/manifest.json?v=clock-1')
    .then(response => { if (!response.ok) throw new Error('Narration manifest unavailable'); return response.json(); })
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

  const roadMat = new THREE.MeshStandardMaterial({ color: 0x17191e, roughness: 0.96 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(11, 420), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, -180);
  road.receiveShadow = true;
  scene.add(road);

  const vergeMat = new THREE.MeshStandardMaterial({ color: 0x17221a, roughness: 1 });
  const surroundingGround=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),vergeMat);
  surroundingGround.name='SurroundingTerrain';surroundingGround.rotation.x=-Math.PI/2;
  surroundingGround.position.set(0,-.025,-180);scene.add(surroundingGround);
  [-1, 1].forEach(side => {
    const verge = new THREE.Mesh(new THREE.PlaneGeometry(18, 420), vergeMat);
    verge.rotation.x = -Math.PI / 2;
    verge.position.set(side * 14.5, -0.02, -180);
    scene.add(verge);
  });

  const lineMat = new THREE.MeshBasicMaterial({ color: 0xc8a84c });
  for (let z = 12; z > -390; z -= 13) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 5.8), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.015, z);
    scene.add(line);
  }

  function makeHouse(x, z, variant) {
    const g = new THREE.Group();
    const wallColors = [0x66564f, 0x505c65, 0x665f4d, 0x53515b];
    const walls = new THREE.Mesh(
      new THREE.BoxGeometry(7 + variant, 3.2, 5.4),
      new THREE.MeshStandardMaterial({ color: wallColors[variant % wallColors.length], roughness: 0.92 })
    );
    walls.position.y = 1.6;
    walls.castShadow = true;
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(5.3 + variant * 0.2, 2.1, 4),
      new THREE.MeshStandardMaterial({ color: 0x241d21, roughness: 1 })
    );
    roof.position.y = 4.2;
    roof.rotation.y = Math.PI / 4;
    const windowMat = new THREE.MeshBasicMaterial({ color: 0xffc77b });
    for (let wx = -1.8; wx <= 1.8; wx += 3.6) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.0), windowMat);
      win.position.set(wx, 2.0, x > 0 ? -2.71 : 2.71);
      win.rotation.y = x > 0 ? Math.PI : 0;
      g.add(win);
    }
    g.add(walls, roof);
    g.position.set(x, 0, z);
    scene.add(g);
  }

  function makeTree(x, z, scale) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2 * scale, 0.28 * scale, 2.4 * scale, 8),
      new THREE.MeshStandardMaterial({ color: 0x35251d, roughness: 1 })
    );
    trunk.position.y = 1.2 * scale;
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.25 * scale, 1),
      new THREE.MeshStandardMaterial({ color: 0x182d20, roughness: 1 })
    );
    crown.position.y = 3.0 * scale;
    g.add(trunk, crown);
    g.position.set(x, 0, z);
    scene.add(g);
  }

  for (let z = -18, i = 0; z > -340; z -= 27, i++) {
    makeHouse(-16 - (i % 2) * 2, z, i % 3);
    makeHouse(16 + ((i + 1) % 2) * 2, z - 8, (i + 1) % 3);
    makeTree(-9.5, z + 7, 0.85 + (i % 3) * 0.12);
    makeTree(9.5, z - 2, 0.9 + ((i + 1) % 3) * 0.1);
  }

  const lampPoleMaterial=new THREE.MeshStandardMaterial({color:0x252b33,roughness:.85});
  const lampGlowMaterial=new THREE.MeshBasicMaterial({color:0xffce83});
  for(let i=0;i<10;i++) {
    const x=i%2 ? -6.4 : 6.4, z=-12-i*30;
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(.065,.09,4.2,8),lampPoleMaterial);
    pole.position.set(x,2.1,z);scene.add(pole);
    const lantern=new THREE.Mesh(new THREE.CylinderGeometry(.16,.12,.32,6),lampGlowMaterial);
    lantern.position.set(x,4.25,z);scene.add(lantern);
    const cap=new THREE.Mesh(new THREE.ConeGeometry(.23,.16,6),lampPoleMaterial);
    cap.position.set(x,4.49,z);scene.add(cap);
    if(i<2) {
      const light=new THREE.PointLight(0xffb85f,.85,15,2);
      light.position.set(x,4.15,z);scene.add(light);
    }
  }

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
  contact.position.set(8.2, -.02, ENCOUNTER_Z);
  contact.rotation.y = -Math.PI / 2;
  contact.visible=false;
  scene.add(contact);
  let npcMixer = null, npcState = NPC_STATES.HIDDEN_CROUCH, npcTime = 0;
  let npcLoaded = false, npcHead = null, npcHeadBase = null;
  const npcActions = {};
  let sensorThermal = true;
  const PATROL_SPEED = 5; // metres/second = 18 km/h
  const OBSERVATION_SPEED = 5 / 3.6; // officer slows to 5 km/h
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
  const vegetation = new THREE.Group();
  vegetation.name = 'PERSON_ONE_VEGETATION';
  vegetation.position.z=ENCOUNTER_Z;
  scene.add(vegetation);
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x263e24, roughness: 1 });
  // Road-side low cover hides the legs without surrounding or intersecting the body.
  [[7.25,.55,.72],[7.35,-.35,.64],[8.65,-1,.85],[8.8,1.2,.75]].forEach(([x,z,h],i) => {
    for (let j=0;j<3;j++) {
      const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(1,1),bushMat);
      bush.scale.set(.43,.40+h*.16,.43);
      bush.position.set(x+(j-1)*.23,h*.48+(j%2)*.15,z+(j%2)*.18);
      bush.rotation.y=i+j*.8;
      bush.castShadow=true; vegetation.add(bush);
    }
  });

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
    contact.visible=patrolElapsed>=ENCOUNTER_DELAY;
    const moving=false; // CrouchWalk is baked and available; encounter stays behind cover for now.
    const peek=seconds%18>=4 && seconds%18<7;
    npcState=moving?NPC_STATES.CROUCH_MOVE:peek?NPC_STATES.PEEK:NPC_STATES.HIDDEN_CROUCH;
    const action=npcActions[moving?'CrouchWalk':'CrouchIdle'];
    for(const other of Object.values(npcActions)) { other.enabled=other===action; if(other===action) other.play(); }
    action.time=moving?(seconds-9)%2:seconds%4;
    if(npcHead && npcHeadBase) npcHead.quaternion.copy(npcHeadBase);
    npcMixer.update(0);
    if(npcHead) npcHeadBase=npcHead.quaternion.clone();
    // Stationary crouch remains behind cover; peeking is a bounded additive rotation.
    contact.position.x=8.2;
    if(npcHead && peek) npcHead.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),.12*Math.sin((seconds%18-4)/3*Math.PI)));
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
    let material=null;
    cockpit.traverse(obj=>{
      if(!obj.isMesh)return;
      for(const candidate of (Array.isArray(obj.material)?obj.material:[obj.material]))
        if(candidate.name==='dash board' && candidate.map)material=candidate;
    });
    if(!material)return;
    const source=material.map,canvas=document.createElement('canvas');
    canvas.width=source.image.width;canvas.height=source.image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(source.image,0,0);
    const texture=source.clone();texture.image=canvas;texture.needsUpdate=true;
    material.map=texture;material.needsUpdate=true;
    originalSpeedometer={canvas,context:ctx,texture,last:null};
  }

  function drawOriginalSpeedometer() {
    if(!originalSpeedometer)return;
    const display=originalSpeedometer,value=Math.round(vehicleSpeed*3.6).toString();
    if(value===display.last)return;display.last=value;
    const ctx=display.context;
    // The source atlas stores the orange LCD sideways. Replace only its speed field.
    ctx.save();ctx.translate(565,1323);ctx.rotate(-Math.PI/2);
    ctx.fillStyle='#20221e';ctx.fillRect(-18,-14,36,28);
    ctx.fillStyle='#ffa254';ctx.font='bold 22px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(value,0,0,34);ctx.restore();display.texture.needsUpdate=true;
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
        ctx.fillText("NIGHT PATROL", 28, 48);
        ctx.fillStyle = "#e8f3ff";
        ctx.font = "bold 74px monospace";
        ctx.fillText(Math.round(vehicleSpeed*3.6).toString(), 32, 144);
        ctx.fillStyle = "#7890a7";
        ctx.font = "20px monospace";
        ctx.fillText("km/h        184° S", 34, 190);
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

  async function speakNaturally(text) {
    if(narrationSource && (narrationActiveText.includes('Slow down.') || text.startsWith('Activity clip recorded.') || text.includes('Clip transmitted successfully'))) {
      if(!narrationQueue.includes(text))narrationQueue.push(text);
      return;
    }
    const generation = ++speechGeneration;
    if (narrationSource) { narrationSource.stop(); narrationSource = null; }
    if (!narrationContext) return;
    const manifest = await narrationManifest;
    const clip = manifest.clips[text];
    if (!clip) return;
    const buffer = await loadNarration(clip);
    if (!buffer || generation !== speechGeneration || narrationContext.state !== 'running') return;
    const source = narrationContext.createBufferSource();
    source.buffer = buffer;
    source.connect(narrationContext.destination);
    source.onended = () => {
      if(narrationSource !== source)return;
      narrationSource=null;
      if(narrationQueue.length)speakNaturally(narrationQueue.shift());
    };
    narrationSource = source;
    narrationActiveText=text;
    if(text.includes("Slow down.") && officerSlowPending)officerSlowAt=patrolElapsed+(clip.slowdown_seconds ?? 7.25);
    if(text.includes('Clip transmitted successfully') && clipMonitorAttention)returnToObservation((buffer.duration+.6)*1000);
    source.start();
    narrationPlayed += 1;
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
        if (!material || material.name.toLowerCase() !== "glass clear") return;
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
    Promise.all([load(ASSETS.roofPlatform),load(ASSETS.ptz),load(ASSETS.interceptor)]).then(([platform,ptz,interceptor])=>{
      roofHardware=new THREE.Group();roofHardware.name='InstalledRoofHardware';cockpit.add(roofHardware);
      roofHardware.add(platform.scene);
      ptzRig=ptz.scene;ptzRig.name='InstalledPTZ';ptzRig.position.set(0,2.028,-.25);roofHardware.add(ptzRig);
      interceptorRig=interceptor.scene;interceptorRig.name='InstalledInterceptor';interceptorRig.position.set(0,2.042,.65);roofHardware.add(interceptorRig);
      ptzPan=ptzRig.getObjectByName('PtzPan');ptzTilt=ptzRig.getObjectByName('PtzTilt');ptzOptical=ptzRig.getObjectByName('PtzOpticalOrigin');
      if(!ptzPan || !ptzTilt || !ptzOptical)throw new Error('PTZ articulation nodes missing');
      // Optical glass is absent from the STL. A modest lens face makes heading readable.
      const lens=new THREE.Mesh(new THREE.CircleGeometry(.018,24),new THREE.MeshStandardMaterial({color:0x305b72,metalness:.65,roughness:.18,side:THREE.DoubleSide}));
      lens.name='PtzLensFace';lens.rotation.y=Math.PI;lens.position.z=-.012;ptzOptical.add(lens);
      roofHardware.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
      roofHardware.updateMatrixWorld(true);updateSensorCamera();done();
    }).catch(error=>{console.error('Roof hardware load failed',error);el.enter.textContent='ROOF HARDWARE LOAD FAILED — RELOAD';});
  }

  function installTouchscreen(done) {
    new THREE.GLTFLoader().load(ASSETS.touchscreen,gltf=>{
      const old=cockpit.getObjectByName('DashboardScreenSurface');
      if(old) { old.visible=false;old.name='LegacyDashboardScreenSurface'; }
      const oldBody=cockpit.getObjectByName('DashboardScreen');
      if(oldBody) oldBody.visible=false;
      mountedTouchscreen=gltf.scene;
      mountedTouchscreen.name='MountedPTZTouchscreen';
      mountedTouchscreen.position.set(.04,1.29,-.33);
      mountedTouchscreen.rotation.set(-.15,.55,0);
      mountedTouchscreen.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
      cockpit.add(mountedTouchscreen);
      const bracket=new THREE.Mesh(new THREE.BoxGeometry(.075,.05,.17),new THREE.MeshStandardMaterial({color:0x15191d,roughness:.85}));
      bracket.name='TouchscreenMountBracket';bracket.position.set(.04,1.29,-.435);cockpit.add(bracket);
      touchscreenSurface=mountedTouchscreen.getObjectByName('DashboardScreenSurface');
      makeTouchscreenUI();
      done();
    },undefined,error=>{console.error('Touchscreen load failed',error);el.enter.textContent='TOUCHSCREEN LOAD FAILED — RELOAD';});
  }

  function makeTouchscreenUI() {
    const canvas=document.createElement('canvas');canvas.width=720;canvas.height=480;
    const texture=new THREE.CanvasTexture(canvas);texture.encoding=THREE.sRGBEncoding;
    const uiScene=new THREE.Scene();
    const uiCamera=new THREE.OrthographicCamera(0,720,480,0,.01,10);uiCamera.position.z=2;
    const background=new THREE.Mesh(new THREE.PlaneGeometry(720,480),new THREE.MeshBasicMaterial({map:texture}));
    background.position.set(360,240,0);uiScene.add(background);
    const feed=new THREE.Mesh(new THREE.PlaneGeometry(533,300),new THREE.MeshBasicMaterial({map:sensorTarget.texture}));
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
        eventClip.url=URL.createObjectURL(eventClip.blob);eventClip.status='READY';
        clipMonitorAttention=true;manualLookUntil=0;
        setMessage('Activity clip recorded. Send the clip to the command center?',true);
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
      expandedDialog.close();
    },delay);
  }

  function keepClipLocal() {
    if(eventClip.status!=='READY')return;
    eventClip.status='KEPT_LOCAL';
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
    observationPhase='RESUMING';resumeLookTime=0;manualLookUntil=0;
    clipMonitorAttention=false;clearTimeout(clipReturnTimer);
    expandedDialog.close();
    setMessage('Officer returning attention to the road. Resuming patrol.',false);
  }

  function touchscreenControls() {
    const buttons=touchscreenBaseControls();
    if(seatedStates.includes(state) && state!==STATES.VEHICLE_FIRST_PERSON)buttons.push({x:438,w:258,y:8,h:48,label:manualPtz?'PTZ CONTROLS':'MANUAL PTZ',physicalOnly:true,action:()=>{
      expandedDialog.showModal();expandedLabel='';if(!manualPtz)manualButton.click();
    }});
    if(observationPhase==='OBSERVING')buttons.push({x:24,w:672,y:340,h:48,label:'PROCEED WITH PATROL',action:proceedPatrol});
    return buttons;
  }

  function touchscreenBaseControls() {
    if(state===STATES.VEHICLE_FIRST_PERSON) return [{x:24,w:672,label:'BEGIN PATROL',action:beginPatrol}];
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
    return ['BEGIN PATROL','SEND CLIP','KEEP LOCAL','PROCEED WITH PATROL'].includes(label);
  }

  function renderTouchscreen() {
    if(!touchscreenUI)return;
    const ui=touchscreenUI,ctx=ui.context;
    const label=[state,observationPhase,manualPtz,eventClip.status,driverSpeedTarget,sensorVisible,sensorThermal,Math.round(vehicleSpeed*3.6).toString(),el.message.textContent].join('|');
    if(label!==ui.lastLabel) {
      ui.lastLabel=label;
      ctx.fillStyle='#07121b';ctx.fillRect(0,0,720,480);
      ctx.fillStyle='#b9d8e9';ctx.font='bold 30px monospace';ctx.fillText('SENTRY ONE PTZ',24,34);
      ctx.fillStyle=ptzHolding()?'#efb94f':'#72d6ad';ctx.font='20px monospace';if(state===STATES.VEHICLE_FIRST_PERSON)ctx.fillText('STANDBY',420,31);
      ctx.fillStyle='#99adbc';ctx.font='20px monospace';
      ctx.fillText(Math.round(vehicleSpeed*3.6).toString()+' km/h · '+(ptzHolding()?'CROUCHING / PARTLY CONCEALED':state===STATES.DISMISSED?'DISMISSED · SCAN RESUMED':'VISIBLE + THERMAL ONLINE'),24,61);
      ctx.fillStyle=eventClip.status==='RECORDING'?'#ffb45a':'#b9d8e9';ctx.font='18px monospace';
      const recordingLabel={RECORDING:'● RECORDING ACTIVITY CLIP · 10 SECONDS',FINALIZING:'FINALIZING CLIP…',READY:'SEND CLIP TO COMMAND CENTER? · SIMULATED LINK',KEPT_LOCAL:'CLIP KEPT IN THIS SESSION · SAVE TO RETAIN',TRANSMITTING:'TRANSMITTING CLIP… · SIMULATED TRANSMISSION',SIMULATED_SEND:'✓ CLIP TRANSMITTED · '+eventClip.sentAt+' · SIMULATED',ERROR:'RECORDING FAILED',UNAVAILABLE:'RECORDING UNSUPPORTED IN THIS BROWSER'}[eventClip.status];
      if(recordingLabel)ctx.fillText(recordingLabel,24,83);
      if(!sensorVisible) {
        ctx.fillStyle='#b9d8e9';ctx.font='bold 32px monospace';ctx.textAlign='center';
        ctx.fillText(state===STATES.DISMISSED?'CONTACT DISMISSED':'READY FOR NIGHT PATROL',360,210);
        ctx.font='23px monospace';ctx.fillText(state===STATES.DISMISSED?'Sentry One PTZ has resumed scanning.':'Tap BEGIN PATROL to start.',360,255);ctx.textAlign='left';
      }
      for(const button of touchscreenControls()) {
        ctx.fillStyle='#203e52';ctx.fillRect(button.x,button.y??400,button.w,button.h??72);
        if(suggestedScreenAction(button.label)){ctx.strokeStyle='#86c6d9';ctx.lineWidth=3;ctx.strokeRect(button.x+2,(button.y??400)+2,button.w-4,(button.h??72)-4);}
        ctx.fillStyle='#e3f1f8';ctx.font=(button.h?'bold 23px monospace':'bold 28px monospace');ctx.textAlign='center';ctx.fillText(button.label,button.x+button.w/2,(button.y??400)+(button.h??72)/2+10);ctx.textAlign='left';
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
    expandedButton.hidden=!seatedStates.includes(state);
    expandedButton.classList.toggle('suggested-action',!expandedDialog.open && innerWidth<=900 && (state===STATES.VEHICLE_FIRST_PERSON || eventClip.status==='READY' || observationPhase==='OBSERVING'));
    if(!expandedDialog.open)return;
    manualButton.hidden=state===STATES.VEHICLE_FIRST_PERSON;
    manualButton.textContent=manualPtz?'AUTO PTZ':'MANUAL PTZ';
    manualButton.setAttribute('aria-pressed',String(manualPtz));
    manualControls.hidden=!manualPtz;
    document.getElementById('manualSensorMode').textContent=sensorThermal?'THERMAL · SWITCH TO VISIBLE':'VISIBLE · SWITCH TO THERMAL';
    document.getElementById('manualPtzBearing').textContent=`Pan ${Math.round(THREE.MathUtils.euclideanModulo(manualPan*180/Math.PI,360))}° · Tilt ${Math.round(manualTilt*180/Math.PI)}°`;
    const labels={READY:'Send the recorded clip to command center?',TRANSMITTING:'Transmitting clip… · Simulated transmission',SIMULATED_SEND:'✓ Clip transmitted to command center · '+eventClip.sentAt+' · Simulated transmission',KEPT_LOCAL:'Clip kept in this session. SAVE CLIP to retain it.',RECORDING:'Recording activity clip…',ERROR:'Clip recording failed.',UNAVAILABLE:'Video recording is unavailable in this browser.'};
    const buttons=touchscreenControls().filter(button=>!button.physicalOnly && !(manualPtz && ['VISIBLE','THERMAL','VIEW VISIBLE','VIEW THERMAL'].includes(button.label)));
    const label=buttons.map(b=>b.label).join('|');
    document.getElementById('expandedStatus').textContent=Math.round(vehicleSpeed*3.6).toString()+' km/h · '+(observationPhase==='OBSERVING'?'Stopped · observing person. ':'')+(labels[eventClip.status]||el.message.textContent);
    if(label!==expandedLabel) {
      expandedLabel=label;
      const controls=document.getElementById('expandedControls');controls.replaceChildren();
      for(const entry of buttons) {
        const button=document.createElement('button');button.type='button';button.textContent=entry.label;
        if(entry.w>300)button.className='wide';
        if(suggestedScreenAction(entry.label))button.classList.add('suggested-action');
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
      expandedContext.fillText(state===STATES.VEHICLE_FIRST_PERSON?'READY FOR PATROL':'PTZ SCANNING',256,144);
    }
  }

  function pressTouchscreen(event) {
    if(!touchscreenSurface)return false;
    const rect=el.canvas.getBoundingClientRect();
    const pointer=new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    const ray=new THREE.Raycaster();ray.setFromCamera(pointer,camera);
    const hit=ray.intersectObject(touchscreenSurface)[0];if(!hit?.uv)return false;
    const x=hit.uv.x*720,y=hit.uv.y*480;
    const button=touchscreenControls().find(b=>x>=b.x && x<=b.x+b.w && y>=(b.y??400) && y<=(b.y??400)+(b.h??72));
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
        cockpit.name = "MAHINDRA_BOLERO_CAMPER";
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
    return point.add(new THREE.Vector3(.16,0,0).applyQuaternion(vehicle.getWorldQuaternion(new THREE.Quaternion())));
  }

  function ready() {
    setState(STATES.READY);
    el.entryPrompt.hidden = true;
    el.entryFade.style.opacity = '0';
    el.console.hidden = true;
    el.lookHint.hidden = true;
    if (entryDoor) entryDoor.rotation.y = 0;
    el.enter.disabled = false;
    el.enter.textContent = "START EXPERIENCE";
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
    for(const [side,x] of [['left',.31],['right',.60]]) {
      footContact(side,targetPosition('driverFootwell'+(side==='left'?'Left':'Right'),vehiclePoint([x,.16,-.43])),vehiclePoint([x,.95,-.65]),1);
      solveContact(rigBones[side+'UpperArm'],rigBones[side+'Forearm'],rigBones[side+'Hand'],
        targetPosition('steeringWheel'+(side==='left'?'Left':'Right')+'Hand',vehiclePoint([x,1.19,-.31])),
        vehiclePoint([side==='left'?.12:.82,.9,-.05]),1);
    }
    seatedRootLocal=vehicle.worldToLocal(operator.position.clone());
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
    setMessage("Operator seated. Start patrol when ready.", true);
  }

  // The gate is checked both when showing the prompt and on activation.
  // Coordinates are vehicle-local, so the passenger side never qualifies.
  function inDriverEntryArea(position = operator.position) {
    const local = vehicle.worldToLocal(position.clone());
    const approach = vehicle.worldToLocal(approachPosition());
    return local.x >= 1.10 && local.x <= 1.70 &&
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

  function showContact() {
    if (contactTriggered) return;
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
    el.sensorTarget.textContent = 'PERSON 1 · UNCONFIRMED';
    el.sensorMode.textContent = 'THERMAL';
    document.querySelector('.track-panel').hidden = false;
    el.trackState.textContent = 'AUTO TRACK · UNCONFIRMED';
    officerSlowPending=true;officerSlowAt=patrolElapsed+7.25;
    startEventRecording();
    alertTone();
    const localContact=vehicle.worldToLocal(contact.getWorldPosition(new THREE.Vector3()));
    const hour=((Math.round(Math.atan2(localContact.x,-localContact.z)/(Math.PI/6))%12)+12)%12;
    const word=['twelve','one','two','three','four','five','six','seven','eight','nine','ten','eleven'][hour];
    const announcement=`Sentry One PTZ. Person detected at your ${word} o'clock. Tracking and recording. Slow down.`;
    const detectedAt=patrolElapsed;
    narrationManifest.then(manifest=>{if(officerSlowPending)officerSlowAt=detectedAt+(manifest.clips[announcement]?.slowdown_seconds ?? 9);});
    setMessage(announcement,true);
  }

  function openThermal() {
    sensorVisible = true;
    sensorThermal = !sensorThermal;
    el.sensor.hidden = true;
    el.sensorTarget.textContent = "PERSON 1 · UNCONFIRMED";
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
    el.sensorTarget.textContent = "PERSON 1 · 0.74";
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

  el.enter.addEventListener("click", beginIntro);
  function beginPatrol() {
    if (state !== STATES.VEHICLE_FIRST_PERSON && state !== STATES.DISMISSED) return;
    driverSpeedTarget=PATROL_SPEED;officerSlowPending=false;officerSlowAt=null;observationPhase="NONE";
    patrolStartedAt = performance.now();
    contactTriggered = false;
    updateNpc(0);
    manualPtz=false;scanAngle=SCAN_START_ANGLE;scanElapsed=0;detectionEvidence=null;vehicleSpeed=0;patrolElapsed=0;contact.visible=false;
    sensorVisible=true;sensorThermal=false;el.sensor.hidden=true;
    el.sensorTarget.textContent="360° SCAN";el.sensorMode.textContent="VISIBLE";
    el.patrol.disabled = true;
    el.patrol.textContent = "PATROL ACTIVE";
    el.sentry.textContent = "360° SCAN";
    el.speed.textContent = "0.0 km/h";
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
    exteriorView=!exteriorView; pointerDown=false;
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
    patrolStep(dt, snapshot=true) {
      if(!debugEntry) return null;
      updatePatrolVehicle(dt);
      updateNpc(npcTime+dt);updatePtzScan(dt);updateSensorCamera();updateOperatorCamera(0);
      return snapshot ? this.npcSnapshot() : state;
    },
    displaySnapshot() {
      const pixels=new Uint8Array(4);renderer.readRenderTargetPixels(touchscreenUI.target,650,34,1,1,pixels);
      return {pixelRatio:renderer.getPixelRatio(),buttonPixel:Array.from(pixels),screenSize:[touchscreenUI.target.width,touchscreenUI.target.height]};
    },
    speedometerSnapshot() {return {observationPhase,clipMonitorAttention,yaw,pitch,value:originalSpeedometer?.last,extraDisplayVisible:cockpit?.getObjectByName("InstrumentClusterSurface")?.visible,officerSlowPending,officerSlowAt};},
    eventSnapshot() {return {status:eventClip.status,sentAt:eventClip.sentAt,sendStarted:eventClip.sendStarted,bytes:eventClip.blob?.size||0,url:eventClip.url,frames:eventClip.frames,error:eventClip.error,driverSpeedTarget,vehicleSpeed};},
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
      return {ptz:box(ptzRig),interceptor:box(interceptorRig),pan:ptzPan.rotation.y,tilt:ptzTilt.rotation.x,opticalOrigin:ptzOrigin().toArray(),opticalDirection:new THREE.Vector3(0,0,-1).applyQuaternion(ptzOptical.getWorldQuaternion(new THREE.Quaternion())).toArray(),sensorDirection:sensorCamera.getWorldDirection(new THREE.Vector3()).toArray()};
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
      patrolElapsed=ENCOUNTER_DELAY;vehicle.position.z=ENCOUNTER_Z+3;showContact();updateNpc(seconds);updateSensorCamera();
      if(view==='DRIVER') { operatorEye.getWorldPosition(camera.position);camera.lookAt(contact.position.clone().add(new THREE.Vector3(0,.9,0))); }
      if(view==='CLOSE') { camera.position.set(5.8,1.55,ENCOUNTER_Z+2.7);camera.lookAt(contact.position.clone().add(new THREE.Vector3(0,.8,0))); }
      sensorThermal=view!=='VISIBLE';el.sensor.hidden=true;
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
      return {loaded:npcLoaded,visible:contact.visible,patrolElapsed,state:npcState,time:npcTime,position:contact.position.toArray(),min:bounds.min.toArray(),max:bounds.max.toArray(),clips:Object.keys(npcActions),bones,triangles,sensorThermal,vehicle:vehicle.position.toArray(),vehicleSpeed,head:npcHead?.quaternion.toArray(),headBase:npcHeadBase?.toArray(),scanAngle,scanElapsed,holding:ptzHolding(),sensorPosition:sensorCamera.position.toArray(),sensorDirection:sensorCamera.getWorldDirection(new THREE.Vector3()).toArray(),sensorTarget:contact.position.clone().add(new THREE.Vector3(0,.78,0)).toArray(),detectionEvidence};
    },
    pause: toggleDebugPause,
    setView(view) { debugCameraView = view; },
    showHelpers(show) { debugHelpersVisible = Boolean(show); updateDebugVisualization(); },
    activate: activateVehicleEntry,
    placeOfficer(localPosition) {
      if (!debugEntry) return false;
      operator.position.copy(vehiclePoint(localPosition));
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
        narration: { context: narrationContext?.state, cached: narrationBuffers.size, played: narrationPlayed, playing: Boolean(narrationSource), error: narrationError },
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
      const cameraOffset = new THREE.Vector3(3.0,2.0,3.3);
      // Keep the whole officer in view, including portrait phone layouts.
      if (camera.aspect < 1) cameraOffset.multiplyScalar(1.35);
      camera.position.copy(operator.position).add(cameraOffset);
      camera.lookAt(operator.position.clone().add(new THREE.Vector3(-.35,1,0)));
      if (u >= 1) {
        playOperatorAction('Idle',true,.2);
        setState(STATES.VEHICLE_ENTRY_AVAILABLE);
        updateEntryPrompt();
      }
    } else if (state === STATES.VEHICLE_ENTRY_TRANSITION) {
      // A brief blink is the cinematic cut from exterior to doorway POV.
      // Relocation happens only at full opacity, never through the body shell.
      el.entryFade.style.opacity = t < .16 ? String(phaseEase(t/.16))
        : t < .30 ? '1' : String(1-phaseEase((t-.30)/.28));
      if (entryDoor) entryDoor.rotation.y = 1.30*phaseEase((t-.10)/.18);
      if (t >= .16) {
        const path = [
          [0,[1.24,1.52,.12]], [.32,[1.04,1.46,.10]],
          [.66,[.72,1.37,.12]], [1,[.456,1.44,.12]]
        ];
        const u = THREE.MathUtils.clamp((t-.30)/1.55,0,1);
        let i = path.findIndex(key => key[0] >= u);
        i = Math.max(1,i);
        const a=path[i-1],b=path[i];
        camera.position.copy(vehiclePoint(a[1])).lerp(vehiclePoint(b[1]),phaseEase((u-a[0])/(b[0]-a[0])));
        const rotation = phaseEase(u);
        camera.rotation.order='YXZ';
        camera.rotation.set(THREE.MathUtils.lerp(.08,pitch,rotation)+.025*Math.sin(Math.PI*u),THREE.MathUtils.lerp(.82,yaw,rotation),.018*Math.sin(Math.PI*u),'YXZ');
        if (u >= 1 && operatorEye) operatorEye.getWorldPosition(camera.position);
      }
      if (t > 1.90 && entryDoor) entryDoor.rotation.y=1.30*(1-phaseEase((t-1.90)/.65));
      if (t >= ENTRY_SECONDS) enterOperatorMode();
    }
  }

  function updateOperatorCamera(now) {
    if (!operatorEye) return;
    const seatedFov=!exteriorView && camera.aspect<1 ? Math.min(100,THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(35))/camera.aspect))) : 70;
    if(camera.fov!==seatedFov){camera.fov=seatedFov;camera.updateProjectionMatrix();}
    operator.visible=exteriorView && !!seatedRootLocal;
    if(seatedRootLocal) {operator.position.copy(vehiclePoint(seatedRootLocal.toArray()));operator.updateMatrixWorld(true);}
    if(exteriorView) {
      const halfFov=THREE.MathUtils.degToRad(camera.fov/2);
      const fitAngle=Math.min(halfFov,Math.atan(Math.tan(halfFov)*camera.aspect));
      const distance=3.1/Math.sin(fitAngle);
      const target=vehicle.localToWorld(new THREE.Vector3(0,1.15,0));
      camera.position.copy(target).add(new THREE.Vector3(
        Math.sin(exteriorYaw)*Math.cos(exteriorElevation),Math.sin(exteriorElevation),
        -Math.cos(exteriorYaw)*Math.cos(exteriorElevation)).multiplyScalar(distance));
      camera.lookAt(target);
      return;
    }
    const pos = new THREE.Vector3();
    operatorEye.getWorldPosition(pos);
    // Rigid seat mount: no walking-style bob or lateral head sway.
    camera.position.copy(pos);
    camera.rotation.order = "YXZ";
    const portraitRest=camera.aspect<1 && observationPhase==='NONE' && !expandedDialog.open && !clipMonitorAttention && patrolElapsed>=manualLookUntil;
    camera.rotation.y = yaw+(portraitRest?.18:0);
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
    } else if(['STOPPING','OBSERVING'].includes(observationPhase)) {
      const offset=contact.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,.95,0)).sub(operatorEye.getWorldPosition(new THREE.Vector3()));
      targetYaw=Math.atan2(-offset.x,-offset.z);
      targetPitch=Math.atan2(offset.y,Math.hypot(offset.x,offset.z));
    } else if(observationPhase==='RESUMING' || screenAttention){targetYaw=.22;if(Math.abs(yaw-.22)<.01)screenAttention=false;}
    if(targetYaw===null)return;
    targetYaw=THREE.MathUtils.clamp(targetYaw,-1.05,1.05);
    targetPitch=THREE.MathUtils.clamp(targetPitch,-.5,.35);
    const step=1-Math.exp(-dt*3);
    yaw+=THREE.MathUtils.clamp((targetYaw-yaw)*step,-dt*.65,dt*.65);
    pitch+=THREE.MathUtils.clamp((targetPitch-pitch)*step,-dt*.45,dt*.45);
  }

  function updatePatrolVehicle(dt) {
    if(![STATES.PATROL,STATES.CONTACT,STATES.INSPECTING,STATES.TRACKING,STATES.DISMISSED].includes(state)) return;
    patrolElapsed+=dt;
    contact.visible=patrolElapsed>=ENCOUNTER_DELAY;
    if(officerSlowPending && patrolElapsed>=officerSlowAt) {
      officerSlowPending=false;officerSlowAt=null;driverSpeedTarget=0;observationPhase="STOPPING";
      setMessage('Officer slowing to a stop to observe the person.',false);
    }
    if(observationPhase==='STOPPING' && vehicleSpeed<.01) {
      observationPhase='OBSERVING';
      setMessage('Stopped to observe the person. Select Proceed with Patrol when ready.',false);
    }
    if(observationPhase==='RESUMING') {
      resumeLookTime+=dt;
      if(resumeLookTime>=1.5 && Math.abs(yaw-.22)<.04){observationPhase='NONE';driverSpeedTarget=PATROL_SPEED;}
    }
    updateDriverAttention(dt);
    const targetSpeed=driverSpeedTarget;
    const previousSpeed=vehicleSpeed;
    vehicleSpeed=THREE.MathUtils.clamp(targetSpeed,Math.max(0,vehicleSpeed-1.1*dt),vehicleSpeed+1.4*dt);
    const travel=(previousSpeed+vehicleSpeed)*.5*dt;
    vehicle.position.z-=travel;
    wheelTravel+=travel;
    rollingWheels.forEach(({pivot,radius})=>{pivot.rotation.x=-wheelTravel/radius;});

    el.speed.textContent=Math.round(vehicleSpeed*3.6).toString()+' km/h';
    el.driveMode.textContent=driverSpeedTarget===0?(vehicleSpeed<.01?'STOPPED · OBSERVING':'DRIVER BRAKING'):driverSpeedTarget<PATROL_SPEED?'DRIVER SLOW':'DRIVER PATROL';
  }

  function ptzOrigin() {
    vehicle.updateMatrixWorld(true);
    return ptzOptical ? ptzOptical.getWorldPosition(new THREE.Vector3()) : ptzMount ? ptzMount.getWorldPosition(new THREE.Vector3()) : vehicle.position.clone().add(new THREE.Vector3(0,2.1,-.2));
  }

  function ptzTarget() { return contact.position.clone().add(new THREE.Vector3(0,1.10,0)); }

  function ptzHolding() {
    return !manualPtz && [STATES.TRACKING,STATES.CONTACT,STATES.INSPECTING].includes(state);
  }

  function updatePtzScan(dt) {
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
    const ray=new THREE.Raycaster(origin,offset.clone().normalize(),0,range-.05);
    const occluded=ray.intersectObject(vegetation,true).length>0;
    if(range<=60 && Math.abs(error)<=THREE.MathUtils.degToRad(14) && Math.abs(elevationError)<=THREE.MathUtils.degToRad(14) && !occluded) {
      detectionEvidence={range,bearing,scanAngle,error,vehicleZ:vehicle.position.z,targetZ:target.z,scanElapsed,occluded};
      manualPtz=false;showContact();
    }
  }

  function updateSensorCamera() {
    const target=ptzHolding()?contact.position.clone().add(new THREE.Vector3(0,.78,0)):null;
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
  fullscreenButton.addEventListener('click',async()=>{
    try {
      if(document.fullscreenElement)await document.exitFullscreen();
      else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen({navigationUI:'hide'});
      else throw new Error('Fullscreen unavailable');
    } catch(_) {
      const hint=document.getElementById('fullscreenHint');
      hint.textContent='Fullscreen is unavailable in this browser. Try Add to Home screen from the browser menu.';
      hint.hidden=false;setTimeout(()=>{hint.hidden=true;},7000);
    }
  });
  document.addEventListener('fullscreenchange',()=>{
    fullscreenButton.textContent=document.fullscreenElement?'EXIT FULLSCREEN':'FULLSCREEN';resize();
  });
  resize();

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
    const elapsed = Math.min(clock.getDelta(), .25);
    const dt = Math.min(elapsed, .05);
    if (operatorMixer && !debugPaused) operatorMixer.update(dt);
    el.clock.textContent = new Date().toLocaleTimeString([], { hour12: false });

    if (!debugPaused && [STATES.EXTERIOR_THIRD_PERSON,STATES.VEHICLE_ENTRY_TRANSITION].includes(state)) {
      updateIntro(now);
    }
    updateEntryPrompt();
    el.viewToggle.hidden=!seatedStates.includes(state);

    if(!debugPaused) {
      // Consume actual frame time, including slower frames, in small motion steps.
      const steps=Math.max(1,Math.ceil(elapsed/(1/60)));
      for(let i=0;i<steps;i++) { updatePatrolVehicle(elapsed/steps);updatePtzScan(elapsed/steps); }
      if([STATES.PATROL,STATES.CONTACT,STATES.INSPECTING,STATES.TRACKING].includes(state)) updateNpc(npcTime+elapsed);
    }
    // Both cameras consume the final vehicle and skeleton transforms of this frame.
    scene.updateMatrixWorld(true);
    if(!debugPaused && [STATES.VEHICLE_FIRST_PERSON,STATES.PATROL,STATES.CONTACT,STATES.INSPECTING,STATES.TRACKING,STATES.DISMISSED].includes(state)) updateOperatorCamera(now);
    updateDebugVisualization();
    updateDebugCamera();
    updateSensorCamera();
    el.scanReadout.hidden=!exteriorView || !seatedStates.includes(state);
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
    renderer.setViewport(0, 0, el.stage.clientWidth, el.stage.clientHeight);
    renderer.setScissorTest(false);
    renderer.render(scene, camera);
    // PTZ imagery is displayed on the mounted touchscreen, not a floating popup.
  }

  loadNpc(() => loadOfficer(loadCockpit));
  requestAnimationFrame(animate);
})();

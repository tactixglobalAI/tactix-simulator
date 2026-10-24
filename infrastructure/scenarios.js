/* Illustrative mission environments. Sensor controls remain in the shared viewer. */
window.initScenario=({scene,root,camera,controls})=>{
 const $=id=>document.getElementById(id);
 const missions={
 emergency:{title:'Emergency Connectivity · Temporary access',mark:'EMERGENCY SUPPORT',color:0xe1e7e8,accent:0x246f88,event:'Temporary Wi-Fi access',objective:'Provide temporary connectivity around an aid point or incident coordination area.',capability:'Use mesh links to connect local Wi-Fi access points. An optional internet gateway can provide external access. Separate guest and responder traffic from sensor and command systems, with access rules and bandwidth limits.',alert:'An operator checks the available uplink, access-point status, and connected users before opening access.',command:'“Enable the approved guest network and reserve capacity for responders.”',note:'Proposed connectivity deployment. Requires compatible Wi-Fi access points, a configured gateway and network isolation. Internet needs a working external uplink; coverage and user capacity require field validation.'},
 
 patrol:{title:'Give clients more than a patrol visit.',mark:'PRIVATE PATROL',color:0xcbd3d8,accent:0x183a52,event:'Person crouching near the fence',objective:'Inspect an after-hours warehouse boundary and assess a person crouching in the bushes without assuming intent.',capability:'Use RGB and thermal PTZ observation to inspect the visible person and surrounding area. Acoustic sensors can flag unusual sounds and cue camera verification. Report findings and ask the patrol officer for direction.',alert:'“A person is crouching in the bushes beside the warehouse fence. Inspect with thermal, continue observing, or notify patrol?”',command:'“Show the thermal view, maintain observation, and send the clip to command.”',note:'Thermal imaging does not see through dense vegetation. Observation depends on a clear view.'},
 refinery:{title:'Industrial Sites · Inspection & security',mark:'SITE SECURITY',color:0xe4dcc7,accent:0xab642c,event:'Thermal equipment inspection',objective:'Inspect tanks and pipework for unusual heat patterns while maintaining restricted-area security.',capability:'A tethered inspection drone with a thermal payload provides elevated thermal views of tanks and pipework. Operators review heat signatures for signs of possible leaks or abnormal equipment temperatures and save imagery for maintenance assessment.',alert:'Operator reviews the thermal feed for temperature differences that may indicate a leak or equipment issue.',command:'“Show the thermal view of the pipework and save these frames for inspection.”',note:'Shown with an assumed thermal drone payload. A heat anomaly is not a confirmed leak; reliable gas-leak detection may require a dedicated optical gas-imaging camera.'},
 police:{title:'Law Enforcement · Event verification',mark:'POLICE',color:0x18232c,accent:0xeeeeea,event:'Suspected gunshot · acoustic event',objective:'Alert officers to a suspected gunshot and preserve a timestamped event for assessment.',capability:'Acoustic recognition flags a possible gunshot signature. Cue RGB/thermal observation for available visual context, notify the officer, and offer to share the event with command.',alert:'“Possible gunshot detected. Review the camera view or send the event to command?”',command:'“Show the surrounding area, preserve the timestamp, and share the event.”',note:'Acoustic classification is a cue for assessment, not confirmation of a shooter or a precise source location.'},
 port:{title:'Port Security · Waterfront access',mark:'PORT SECURITY',color:0xcfd9df,accent:0x22526d,event:'Person approaching restricted gate',objective:'Monitor a waterfront access point and coordinate observations around containers and restricted boundaries.',capability:'Use the vehicle PTZ and a fixed sensor pole for complementary views. Flag a person approaching the restricted gate, verify visually, and share the event with tactixglobalMCT.',alert:'“A person is approaching the restricted waterfront gate. Show the fixed-pole view or notify gate security?”',command:'“Show both views, record the event, and notify gate security.”',note:'Representative waterfront setting relevant to Port Hueneme security; no actual installation layout or agency affiliation is depicted.'},
 military:{title:'Defense · Drone observation & verification',mark:'PERIMETER SECURITY',color:0x596048,accent:0xc5c6aa,event:'Unidentified drone',objective:'Provide early awareness of a possible drone approaching an installation perimeter.',capability:'Acoustic sensing flags a possible drone signature and cues RGB/thermal observation. Alert personnel, request visual verification, and share available evidence over the mesh.',alert:'“Possible drone acoustic signature detected near the perimeter. Inspect visually or share the alert with command?”',command:'“Cue the PTZ, continue observation, and send the event to command.”',note:'Detection and human verification only. The scene does not imply identification, interception, or counter-drone capability.'}
 };
 const customerValue={"patrol": {"benefit": "Show clients what happened, how your officer responded, and what needs attention.", "value": "Offer documented incidents, selected clips, and supervisor-reviewed reports as a premium patrol service.", "heading": "POTENTIAL SERVICE OFFERING"}, "refinery": {"benefit": "Bring perimeter observations and equipment inspection imagery into one reviewable record for security and maintenance teams.", "value": "Offer scheduled perimeter checks and documented inspection support using ground and elevated views.", "heading": "POTENTIAL SERVICE OFFERING"}, "police": {"benefit": "Give officers context for reported events and supervisors a traceable account of the actions taken.", "value": "Support incident verification, evidence review, and accountable reporting while keeping operators in control.", "heading": "OPERATIONAL VALUE"}, "port": {"benefit": "Coordinate observations across gates, yards, and changing work areas without relying on public communications.", "value": "Deploy temporary coverage for projects or events, and connect mobile patrols with fixed observation points.", "heading": "OPERATIONAL VALUE"}, "military": {"benefit": "Maintain local awareness and share observations where external communications may be unavailable.", "value": "Reuse the same sensing and communications system across vehicles, temporary posts, and perimeter missions.", "heading": "OPERATIONAL VALUE"}, "emergency": {"benefit": "Extend temporary connectivity to responders and nearby users when normal access is unavailable.", "value": "Offer a deployable communications service for emergency staging areas, temporary shelters, and field operations.", "heading": "POTENTIAL SERVICE OFFERING"}};
 let environment=new THREE.Group(),livery=new THREE.Group(),current='patrol',buildVersion=0,deployment=null;scene.add(environment);root.add(livery);
 let viewMode='day';const overrides=new Map();
 const modeBar=document.createElement('div');modeBar.className='thermal-options';modeBar.setAttribute('role','group');modeBar.setAttribute('aria-label','Patrol imaging view');document.querySelector('.toolbar').after(modeBar);
 const modeCaption=document.createElement('p');modeCaption.className='imaging-caption';modeBar.after(modeCaption);
 function restoreView(){for(const [o,m] of overrides){o.material.dispose();o.material=m;}overrides.clear();}
 function applyView(){restoreView();modeBar.hidden=true;modeCaption.hidden=true;
 modeCaption.textContent=viewMode==='thermal'?'Illustrative thermal view · warmer visible surfaces appear brighter · foliage remains opaque':viewMode==='night'?'Night RGB · reduced ambient visibility':'Day RGB';
 modeBar.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===viewMode)));
 if(current!=='patrol'||viewMode==='day')return;
 for(const group of [root,environment])group.traverse(o=>{if(!o.isMesh)return;let human=false;for(let a=o;a;a=a.parent)if(a.name==='Patrol person')human=true;
 const original=o.material;let color;
 if(viewMode==='thermal'){const source=Array.isArray(original)?original[0]:original;const level=source.color?THREE.MathUtils.clamp((source.color.r+source.color.g+source.color.b)/3*.22+.025,.025,.24):.08;color=human?new THREE.Color(0xffd486):new THREE.Color(level*.7,level*.82,level);}
 else {const m=Array.isArray(original)?original[0]:original;color=m.color?m.color.clone().multiply(new THREE.Color(.22,.30,.48)):new THREE.Color(0x293847);}
 const m=new THREE.MeshStandardMaterial({color,roughness:1,skinning:!!o.isSkinnedMesh,side:THREE.DoubleSide,emissive:viewMode==='thermal'&&human?0xffc46b:0x000000,emissiveIntensity:.55});overrides.set(o,original);o.material=m;
 });
 }
 for(const [mode,title] of [['day','Day RGB'],['night','Night RGB'],['thermal','Thermal']]){const b=document.createElement('button');b.textContent=title;b.dataset.mode=mode;b.onclick=()=>{viewMode=mode;applyView();};modeBar.append(b);}
 const paint=[];root.traverse(o=>{if(o.isMesh){const ms=Array.isArray(o.material)?o.material:[o.material];o.material=Array.isArray(o.material)?ms.map(m=>m.clone()):ms[0].clone();const own=Array.isArray(o.material)?o.material:[o.material];own.forEach(m=>{if(/plain white|warm white side/i.test(m.name))paint.push(m);});}});
 const mat=(color)=>new THREE.MeshStandardMaterial({color:new THREE.Color(color).convertSRGBToLinear(),roughness:.8});
 function mesh(g,m,x,y,z,parent=environment){const o=new THREE.Mesh(g,m);o.position.set(x,y,z);parent.add(o);return o;}
 function box(w,h,d,x,y,z,c,parent=environment){return mesh(new THREE.BoxGeometry(w,h,d),mat(c),x,y,z,parent);}
 function cyl(r,h,x,y,z,c){return mesh(new THREE.CylinderGeometry(r,r,h,20),mat(c),x,y,z);}
 function ball(r,x,y,z,c){return mesh(new THREE.SphereGeometry(r,14,10),mat(c),x,y,z);}
 function rod(a,b,r,c){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),v=bv.clone().sub(av),o=mesh(new THREE.CylinderGeometry(r,r,v.length(),8),mat(c),...av.add(bv).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());return o;}
 function textTexture(text,bg='#163a4a',fg='#ffffff'){const c=document.createElement('canvas');c.width=1024;c.height=192;const ctx=c.getContext('2d');ctx.fillStyle=bg;ctx.fillRect(0,0,1024,192);ctx.fillStyle=fg;ctx.font='bold 64px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,96,980);const t=new THREE.CanvasTexture(c);t.encoding=THREE.sRGBEncoding;return t;}
 function sign(text,x,y,z,w=3){const o=mesh(new THREE.PlaneGeometry(w,w*.1875),new THREE.MeshBasicMaterial({map:textTexture(text),side:THREE.DoubleSide,toneMapped:false}),x,y,z);return o;}
 function marker(text,x,y,z){const o=new THREE.Sprite(new THREE.SpriteMaterial({map:textTexture(text,'#79491e'),depthTest:false,toneMapped:false}));o.position.set(x,y,z);o.scale.set(4.5,.85,1);environment.add(o);}
 function fence(x1,x2,z){for(let x=x1;x<=x2;x+=1.2)rod([x,0,z],[x,2,z],.035,0x697b7d);for(const y of [.35,1.15,1.95])rod([x1,y,z],[x2,y,z],.025,0x697b7d);for(let x=x1;x<x2;x+=.4){rod([x,.1,z],[Math.min(x+1,x2),1.9,z],.008,0x778786);}}
 function shrub(x,z,r=.6){ball(r,x,r*.75,z,0x344a31);ball(r*.7,x+.4,r*.75,z+.1,0x49613d);}
 function person(x,z,crouch=false){const start=environment.children.length;const requestedVersion=buildVersion;const skin=0xb78d70,cloth=0x303f4b;const hip=crouch?.65:.95,shoulder=crouch?1.03:1.5,head=crouch?1.32:1.77;
 ball(.15,x,head,z,skin);rod([x,hip,z+.08],[x,shoulder,z],.16,cloth);
 for(const d of [-1,1]){const knee=[x+d*.19,crouch?.3:.5,z-(crouch?.3:0)];rod([x+d*.1,hip,z+.08],knee,.075,cloth);rod(knee,[x+d*.18,.1,z+.18],.065,cloth);rod([x+d*.18,shoulder-.02,z],[x+d*.26,crouch?.7:1.05,z-.15],.055,cloth);}
 const placeholder=environment.children.slice(start);
 new THREE.GLTFLoader().load('../assets/models/us_hooded_npc.glb',g=>{
 if(buildVersion!==requestedVersion){g.scene.traverse(o=>{if(o.geometry)o.geometry.dispose();});return;}
 const actor=g.scene;
 if(crouch){const clip=g.animations.find(a=>a.name==='CrouchIdle');if(clip){const mixer=new THREE.AnimationMixer(actor);mixer.clipAction(clip).play();mixer.update(.1);}}
 // Measure the posed, skinned vertices rather than the unposed geometry bounds.
 actor.updateMatrixWorld(true);actor.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.frustumCulled=false;}});
 const bounds=new THREE.Box3(),v=new THREE.Vector3();actor.traverse(o=>{if(!o.isMesh)return;const positions=o.geometry.attributes.position;for(let i=0;i<positions.count;i++){v.fromBufferAttribute(positions,i);if(o.isSkinnedMesh)o.boneTransform(i,v);v.applyMatrix4(o.matrixWorld);bounds.expandByPoint(v);}});
 const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
 const normalized=new THREE.Group();normalized.add(actor);const scale=(crouch?1.2:1.8)/size.y;normalized.scale.setScalar(scale);normalized.position.set(-center.x*scale,-bounds.min.y*scale+.02,-center.z*scale);
 const body=new THREE.Group();body.name='Patrol person';body.add(normalized);body.position.set(x,0,z);body.rotation.y=Math.PI*.7;
 document.body.dataset.personLoaded='true';document.body.dataset.personPose=crouch?'crouched':'standing';
 placeholder.forEach(o=>{environment.remove(o);o.geometry.dispose();o.material.dispose();});environment.add(body);applyView();
 },undefined,()=>{});
 }
 function drone(x,y,z,thermal=false){box(.55,.18,.4,x,y,z,0x273e4b);for(const dx of [-.55,.55])for(const dz of [-.45,.45]){rod([x,y,z],[x+dx,y,z+dz],.035,0x273e4b);cyl(.23,.025,x+dx,y+.08,z+dz,0x344b59);}ball(.12,x,y-.18,z,thermal?0xb16c31:0x22353c);}
 function warehouse(){box(9,3.8,2.5,0,1.9,-7,0x717c80);box(9.3,.16,2.8,0,3.87,-7,0x3b4a54);box(2.8,2.7,.06,-1,1.35,-5.72,0x46565e);for(let x=-4;x<4;x+=.7)box(.025,3.4,.03,x,1.9,-5.71,0x92a0a4);sign('WAREHOUSE · AUTHORIZED ACCESS',0,3.25,-5.66,5);}
 function dispose(group){group.traverse(o=>{if(o.geometry)o.geometry.dispose();const ms=o.material?(Array.isArray(o.material)?o.material:[o.material]):[];ms.forEach(m=>{if(m.map)m.map.dispose();m.dispose();});});group.clear();}
 function decorate(m){dispose(livery);paint.forEach(p=>p.color.setHex(m.color).convertSRGBToLinear());
 for(const side of [-1,1]){const label=new THREE.Mesh(new THREE.PlaneGeometry(1.65,.31),new THREE.MeshBasicMaterial({map:textTexture(m.mark,current==='police'?'#eeeeea':'#163a4a',current==='police'?'#15212b':'#ffffff'),side:THREE.DoubleSide,toneMapped:false}));label.position.set(side*1.015,1.04,.2);label.rotation.y=side*Math.PI/2;livery.add(label);
 const stripe=new THREE.Mesh(new THREE.PlaneGeometry(2.45,.09),new THREE.MeshBasicMaterial({color:m.accent,side:THREE.DoubleSide}));stripe.position.set(side*1.02,.82,.2);stripe.rotation.y=side*Math.PI/2;livery.add(stripe);}
 }
 function build(id){restoreView();if(deployment){deployment.restore();deployment=null;}buildVersion++;current=id;dispose(environment);const m=missions[id];decorate(m);
 $('mission-title').textContent=m.title;document.querySelector('.mission-kicker').textContent=id==='patrol'?'PRIVATE PATROL · SERVICE OPPORTUNITY':'MISSION EXAMPLE';const value=customerValue[id];$('mission-benefit').textContent=value.benefit;$('mission-value').textContent=value.value;$('mission-value-heading').textContent=value.heading;$('mission-alert').previousElementSibling.textContent=id==='refinery'?'OPERATOR INSPECTION':id==='emergency'?'DEPLOYMENT CHECK':'EXAMPLE SYSTEM ALERT';for(const field of ['objectives','capabilities','alert','command','note'])$( 'mission-'+field).textContent=m[{objectives:'objective',capabilities:'capability'}[field]||field];
 // Ground and a clear vehicle approach lane.
 box(24,.08,23,0,-.10,-2,id==='military'?0x77765c:id==='patrol'?0x637364:0x75818a);
 box(6,.018,17,0,-.047,2,0x46545f);for(let z=-4;z<10;z+=2)box(.08,.012,.9,-2.4,-.032,z,0xb2b9ad);
 if(id==='patrol'){warehouse();fence(2,8,-4.8);for(const [x,z,r] of [[3,-3.8,.48],[4.2,-4.2,.65],[5.3,-4.1,.75],[3.45,-3.45,.40]])shrub(x,z,r);person(3.45,-4.05,true);marker(m.event,3.8,2.15,-3.5);}
 if(id==='refinery'){for(const [x,z,r] of [[-4,-6,1.4],[0,-8,1.7],[4,-7,1.4]]){cyl(r,3.6,x,1.8,z,0xb6babb);cyl(r+.08,.12,x,3.65,z,0x5c7079);for(let y=.6;y<3.6;y+=1)cyl(r+.025,.045,x,y,z,0x71828b);}
 for(const y of [.7,1.3]){rod([-5,y,-3.9],[5,y,-3.9],.11,0x8a9b9c);rod([4,y,-3.9],[4,y+1.7,-5.8],.11,0x8a9b9c);}deployment=window.deployRoofDrone(root,root,[3,4.5,-2.6]);document.body.dataset.deployedDroneParts=deployment.count;
 // Continuous physical tether from the roof attachment to the inspection drone.
 deployment.flight.updateMatrixWorld(true);
 const droneBody=deployment.flight.children.find(o=>/drone[ _]cap[ _]enclosure/i.test(o.name))||deployment.flight;
 const bodyBounds=new THREE.Box3().setFromObject(droneBody);
 const attachment=bodyBounds.getCenter(new THREE.Vector3());attachment.y=bodyBounds.min.y+.015;
 environment.worldToLocal(attachment);
 const tetherPoints=[new THREE.Vector3(0,1.95,1.35),new THREE.Vector3(.9,2.5,.1),new THREE.Vector3(2,3.25,-1.3),attachment];
 document.body.dataset.tetherAttached='true';
 const tether=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(tetherPoints),32,.025,6,false),new THREE.MeshBasicMaterial({color:0x080808,toneMapped:false}));environment.add(tether);
 cyl(.16,.12,0,1.94,1.35,0x263d47);
 marker('Tethered thermal inspection',3,5.4,-3);fence(-8,-3,-2.8);sign('PROCESS AREA · RESTRICTED',-5,2,-2.7,3.5);}
 if(id==='police'){for(const [x,c] of [[-5,0x78848b],[0,0x928f82],[5,0x647b88]]){box(4.5,4,2,x,2,-7,c);for(const dx of [-1,1])box(1,1,.06,x+dx,2.7,-5.96,0x254451);box(.8,1.9,.06,x,1,-5.96,0x354955);}
 for(let x=-6;x<7;x+=2)box(.06,.02,2,x,-.02,-3,0xd8d7cb);for(const r of [.35,.7,1.05]){const ring=mesh(new THREE.TorusGeometry(r,.025,8,40),new THREE.MeshBasicMaterial({color:0xe4a552}),4,1.4,-3);ring.rotation.y=-.3;}
 marker(m.event,4,3,-3);sign('PARKING',-5,4.4,-5.8,2);}
 if(id==='port'){box(24,.015,6,0,-.04,-11,0x2b6a80);for(const [x,z,c] of [[-5,-6,0x8e654d],[0,-7,0x527681],[5,-8,0x8d8b64]]){box(4.2,2.3,2,x,1.15,z,c);for(let dx=-2;dx<2;dx+=.28)box(.04,2.1,.03,x+dx,1.15,z+1.02,0x54656d);}
 fence(2,8,-3.8);person(3.5,-2.6);sign('RESTRICTED WATERFRONT',5,2.4,-3.7,3.5);rod([-4,0,-2],[-4,4.8,-2],.09,0xa2afb0);box(.3,.4,.25,-4,4.95,-2,0x304853);box(.7,.5,.08,-3.65,3,-2,0x274d71);marker(m.event,3.8,3.1,-2.6);}
 if(id==='military'){fence(-8,8,-6);box(3,2.4,2,-5,1.2,-8,0x747961);box(3.2,.15,2.2,-5,2.45,-8,0x454d3d);sign('CONTROLLED PERIMETER',0,2.6,-5.9,4);for(const x of [-7,6]){rod([x,0,-6],[x,4,-6],.08,0x747c68);box(.4,.2,.2,x,4,-6,0xd1cda8);}drone(3,5,-4);marker(m.event,3,6,-4);}
 if(id==='emergency'){
 box(6,2.8,3,0,1.4,-7,0xc8d4d8);box(6.4,.16,3.4,0,2.88,-7,0x325c71);sign('COMMUNITY AID POINT',0,2.3,-5.46,4.8);
 for(const x of [-5,5]){rod([x,0,-3],[x,3.8,-3],.07,0x9caeb5);box(.34,.52,.15,x,3.5,-3,0xeeeae2);sign('WI-FI ACCESS',x,4.2,-2.9,2.6);}
 person(3.5,-4.6);person(-3.5,-4.6);box(.7,1,.6,-4.9,.5,-3,0x244b5c);
 rod([-5,3.5,-3],[5,3.5,-3],.025,0x3290ae);marker('Mesh link · local Wi-Fi access points',0,5,-4);
 sign('OPTIONAL INTERNET GATEWAY',-5,1.4,-2.6,3.2);
 }
 camera.position.set(11,9,14);controls.target.set(0,1.4,-2);controls.maxDistance=32;controls.update();
 $('details').hidden=true;document.body.dataset.scenario=id;applyView();
 }
 document.querySelectorAll('[name=scenario]').forEach(r=>r.addEventListener('change',()=>build(r.value)));
 $('reset').onclick=()=>{camera.position.set(11,9,14);controls.target.set(0,1.4,-2);controls.update();};
 // Mission views start uncluttered; sensor picking remains available.
 if($('labels').getAttribute('aria-pressed')==='true')$('labels').click();
 build(document.querySelector('[name=scenario]:checked').value);
};

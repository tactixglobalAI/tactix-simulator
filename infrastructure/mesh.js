(() => {
'use strict';
document.body.classList.add('mesh');
const $=id=>document.getElementById(id),stage=$('stage'),canvas=$('view');
let renderer;try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});}catch(e){$('load-text').textContent='Please enable WebGL to view the mesh network.';return;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputEncoding=THREE.sRGBEncoding;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.1,200),controls=new THREE.OrbitControls(camera,canvas);controls.enableDamping=true;controls.minDistance=12;controls.maxDistance=60;controls.maxPolarAngle=Math.PI*.49;
scene.add(new THREE.HemisphereLight(0xe7f4ff,0x7e8890,.9));for(const [x,y,z] of [[4,12,5],[-8,5,-4]]){const l=new THREE.DirectionalLight(0xffffff,1.1);l.position.set(x,y,z);scene.add(l);}
const dark=new THREE.MeshStandardMaterial({color:0x263942,roughness:.65}),light=new THREE.MeshStandardMaterial({color:0xb9c9d1,roughness:.6});
function box(w,h,d,x,y,z,mat=dark){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);scene.add(m);return m;}
function line(points,color,dashed=false){const g=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p)));const m=dashed?new THREE.LineDashedMaterial({color,dashSize:.35,gapSize:.2}):new THREE.LineBasicMaterial({color});const o=new THREE.Line(g,m);o.computeLineDistances();scene.add(o);return o;}
const ground=new THREE.Mesh(new THREE.CircleGeometry(18,80),new THREE.MeshBasicMaterial({color:0xa6b6c1,transparent:true,opacity:.22}));ground.rotation.x=-Math.PI/2;ground.position.y=-.05;scene.add(ground);
// Diagram spacing is compressed so equipment remains inspectable.
const v1=[-6,0,3],v2=[5,0,6],tower=[7,0,-6],drone=[-6,8,3];
const steel=new THREE.MeshStandardMaterial({color:0x334b59,roughness:.75});
const windowMat=new THREE.MeshStandardMaterial({color:0x173748,roughness:.3});
function beam(a,b,r=.065,mat=steel){const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),d=end.clone().sub(start);const o=new THREE.Mesh(new THREE.CylinderGeometry(r,r,d.length(),8),mat);o.position.copy(start.add(end).multiplyScalar(.5));o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());scene.add(o);return o;}
function moveRecent(start,dx,dy,dz){const items=scene.children.slice(start);const group=new THREE.Group();scene.add(group);items.forEach(o=>group.add(o));group.position.set(dx,dy,dz);}
const shelterStart=scene.children.length;
// Field command shelter: roof, door, windows, steps and a communications mast.
box(4,2.4,2.6,-4,1.2,-5,light);box(4.3,.18,2.9,-4,2.48,-5,steel);
box(.85,1.9,.08,-3.1,.95,-3.66,steel);box(1.3,.75,.09,-4.7,1.5,-3.65,windowMat);
box(.9,.15,.6,-3.1,.075,-3.2,steel);box(.07,.07,.1,-2.82,1,-3.59,light);
for(const z of [-5.6,-4.4])box(.09,.8,.7,-1.95,1.5,z,windowMat);
beam([-5.4,2.5,-5],[-5.4,5,-5],.07);box(.35,.65,.12,-5.4,4.7,-5,steel);
moveRecent(shelterStart,-2,0,-3);
const poleStart=scene.children.length;
// Pole-mounted fixed node: top PTZ, radial sensor arms, side solar panel.
box(1.1,.22,1.1,5,.11,-5,light);
beam([5,.22,-5],[5,6.3,-5],.14,steel);
for(const x of [4.63,5.37])for(const z of [-5.37,-4.63])beam([x,.2,z],[x,.32,z],.045,steel);
function collar(y){const ring=new THREE.Mesh(new THREE.CylinderGeometry(.19,.19,.12,20),light);ring.position.set(5,y,-5);scene.add(ring);}
for(const y of [1.3,2.6,3.9,4.8,5.7])collar(y);
// Separate cantilever brackets place acoustic pods and radios around the pole.
beam([5,5.7,-5],[4.3,5.7,-5],.045);beam([5,5.7,-5],[5.7,5.7,-5],.045);
beam([5,4.8,-5],[5,4.8,-4.55],.045);beam([5,4.8,-5],[5,4.8,-5.45],.045);
box(.7,1,.42,5,1.55,-4.66,light);box(.56,.8,.035,5,1.55,-4.43,steel);
// Tilted photovoltaic panel with aluminum frame and visible cell grid.
const solar=new THREE.Group();solar.position.set(6.05,3.25,-5);solar.rotation.z=-.55;scene.add(solar);
function panelPart(w,h,d,x,y,z,mat){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);o.position.set(x,y,z);solar.add(o);}
const cells=new THREE.MeshStandardMaterial({color:0x102f60,roughness:.38,metalness:.15});
panelPart(1.65,.09,2.15,0,0,0,light);
for(let i=0;i<4;i++)for(let j=0;j<6;j++)panelPart(.37,.025,.32,-.585+i*.39,.06,-.875+j*.35,cells);
beam([5,2.6,-5],[6.05,3.25,-5],.05);beam([5,3.9,-5],[5.8,3.4,-5],.05);
moveRecent(poleStart,2,0,-1);
const aerialStart=scene.children.length;
// Tethered aerial relay with a downward-looking camera.
box(.55,.22,.55,-4,7,3);box(.16,.13,2,-4,7,3);box(2,.13,.16,-4,7,3);
for(const [x,z] of [[-5,3],[-3,3],[-4,2],[-4,4]]){const rotor=new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,.025,28),steel);rotor.position.set(x,7.12,z);scene.add(rotor);}
const cam=new THREE.Mesh(new THREE.SphereGeometry(.18,16,12),windowMat);cam.position.set(-4,6.74,3);scene.add(cam);
moveRecent(aerialStart,-2,1,0);
beam([-6,2.7,3],drone,.025,new THREE.MeshBasicMaterial({color:0x00796c}));
for(const pair of [[[-5.4,2.7,3],drone],[[5,2.7,6],drone],[drone,[7,6.1,-6]],[[5,2.7,6],[7,6.1,-6]],[[7,6.1,-6],[-7.4,4.7,-8]]])line(pair,0x00628d,true);
const annotations=[['Vehicle 1',[-6,.2,5.5]],['Vehicle 2',[5,.2,8.5]],['tactixglobalMCT · Command center',[-6,3.2,-8]],['Fixed sensor tower',[7,7.6,-6]],['Tethered sensing & relay drone',[-6,9,3]]].map(([name,p])=>{const el=document.createElement('button');el.className='annotation';el.textContent=name;$('annotations').append(el);el.onclick=()=>{$('details').hidden=false;$('details').querySelector('h3').textContent=name;$('details').querySelector('p').textContent=name==='Fixed sensor tower'?'A top-mounted PTZ, two acoustic pods on radial arms, and mesh radios surround the pole. A side-mounted solar panel supplies a lower battery and edge-compute cabinet. It participates in sensing, workflow coordination, and intelligence sharing.':name==='tactixglobalMCT · Command center'?'A unified view of all connected assets. Collects timestamped events from multiple units, uses an LLM to compile end-of-day mission reports for operator review, and supports voice search by timestamp or time range.':name==='Tethered sensing & relay drone'?'Tethered to Vehicle 1, the drone provides elevated camera coverage and a wireless relay, up to 50 meters above the vehicle.':'Integrated sensing, local workflow orchestration, and mesh communication on a removable roof rack.';};return{el,p:new THREE.Vector3(...p)};});
$('close-details').onclick=()=>{$('details').hidden=true;};
function reset(){controls.target.set(0,2.7,0);camera.position.set(12,13,26);controls.update();}reset();
function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}new ResizeObserver(resize).observe(stage);resize();
$('labels').onclick=()=>{const on=$('labels').getAttribute('aria-pressed')!=='true';$('labels').setAttribute('aria-pressed',String(on));$('labels').textContent=on?'Labels on':'Labels off';$('annotations').hidden=!on;};$('reset').onclick=reset;
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('.visual').requestFullscreen();}catch(e){}};
document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen';resize();});
const decoder=new THREE.DRACOLoader();decoder.setDecoderPath('vendor/');const loader=new THREE.GLTFLoader();loader.setDRACOLoader(decoder);
loader.load('assets/vehicle-rack.glb',g=>{for(const pos of [v1,v2]){const vehicle=g.scene.clone(true);vehicle.position.set(...pos);vehicle.scale.setScalar(1.3);vehicle.rotation.y=Math.PI;scene.add(vehicle);vehicle.traverse(o=>{if(o.isMesh){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{if(m.metalness>.5)m.metalness=.3;});}});}// Reuse individual sensor meshes, normalized and attached to their pole brackets.
const sensorsStart=scene.children.length;
g.scene.updateMatrixWorld(true);
function mountParts(pattern,position,height,rotation=0){
 const group=new THREE.Group();g.scene.traverse(o=>{if(o.isMesh&&pattern.test(o.name)){const c=o.clone();c.matrixAutoUpdate=false;c.matrix.copy(o.matrixWorld);group.add(c);}});
 if(!group.children.length)return;
 const bounds=new THREE.Box3().setFromObject(group),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
 const inner=new THREE.Group();inner.add(group);group.position.set(-center.x,-bounds.min.y,-center.z);
 inner.scale.setScalar(height/size.y);inner.rotation.y=rotation;inner.position.set(...position);scene.add(inner);
}
mountParts(/^(Base_Mounting|Base_PTZ|Main_Structure|Pan_rotation|Front_Camera|Rear_Camera|Side_case_bolt)/i,[5,6.3,-5],.55);
mountParts(/^Pod_front-left/i,[4.3,5.7,-5],.28);
mountParts(/^Pod_rear-right/i,[5.7,5.7,-5],.28);
mountParts(/^Opposite/i,[5,4.8,-4.55],.85,Math.PI/2);
mountParts(/^Opposite/i,[5,4.8,-5.45],.85,-Math.PI/2);
moveRecent(sensorsStart,2,0,-1);
$('loading').hidden=true;$('labels').disabled=false;$('reset').disabled=false;document.body.dataset.loaded='true';decoder.dispose();},undefined,()=>{$('load-text').textContent='The vehicles could not load. Please reload.';});
const p=new THREE.Vector3();function animate(){requestAnimationFrame(animate);controls.update();for(const a of annotations){p.copy(a.p).project(camera);a.el.hidden=Math.abs(p.z)>1;a.el.style.left=Math.max(8,Math.min(stage.clientWidth-a.el.offsetWidth-8,(p.x*.5+.5)*stage.clientWidth-a.el.offsetWidth/2))+'px';a.el.style.top=((-p.y*.5+.5)*stage.clientHeight)+'px';}renderer.render(scene,camera);}animate();
})();

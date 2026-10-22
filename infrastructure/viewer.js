/* Standalone static viewer. No telemetry, cloud, or backend service. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id),stage=$('stage'),canvas=$('view');
 let renderer;
 try {renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});} catch(e){$('load-text').textContent='3D rendering is unavailable. Please enable WebGL or try another browser.';document.querySelector('.spinner').hidden=true;return;}
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputEncoding=THREE.sRGBEncoding;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,1,.05,100);
 const controls=new THREE.OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=3;controls.maxDistance=15;controls.maxPolarAngle=Math.PI*.49;controls.enablePan=true;controls.target.set(0,1.3,.5);
 scene.add(new THREE.HemisphereLight(0xe7f4ff,0x59636c,.9));const key=new THREE.DirectionalLight(0xffffff,1.35);key.position.set(4,8,5);scene.add(key);const fill=new THREE.DirectionalLight(0xc7dcff,.65);fill.position.set(-5,3,-4);scene.add(fill);
 // Soft contact shadow separates the vehicle from the slate ground.
 const shadowCanvas=document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;
 const shadowContext=shadowCanvas.getContext('2d'),gradient=shadowContext.createRadialGradient(64,64,10,64,64,64);
 gradient.addColorStop(0,'rgba(8,15,23,0.48)');gradient.addColorStop(.55,'rgba(8,15,23,0.24)');gradient.addColorStop(1,'rgba(8,15,23,0)');shadowContext.fillStyle=gradient;shadowContext.fillRect(0,0,128,128);
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(3.4,6.4),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false,toneMapped:false}));ground.rotation.x=-Math.PI/2;ground.position.set(0,-.04,.5);scene.add(ground);

 let root,rack,rackY=0,lifted=false,labelsOn=true;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const labelData=[
 ['RGB + Thermal PTZ',[0,2.02,-.18],'Pan, tilt, and zoom observation with RGB and thermal imaging for visual inspection and heat-signature detection.'],
 ['Acoustic pod',[-.55,1.96,-.13],'Trained to recognize unusual sounds, including drone noise, breaking glass, and gunshots, and cue camera verification.'],
 ['Acoustic pod',[.55,1.96,1.91],'Trained to recognize unusual sounds, including drone noise, breaking glass, and gunshots, and cue camera verification.'],
 ['Recon drone',[0,2.1,1.35],'Vehicle-carried reconnaissance drone on the EPM docking platform.'],
 ['EPM docking plate',[.17,1.84,1.18],'Electro-permanent magnetic docking system for retaining the reconnaissance drone.'],
 ['Battery pack',[0,1.90,.8],'Low-profile onboard power pack, mounted flat in its own tray.'],
 ['Edge computer',[.36,1.90,.8],'Onboard processing and behavior-tree workflow orchestration.'],
 ['Mesh radio',[.654,2,.8],'Vehicle mesh communications radio with two upright antennas.'],
 ['Mesh radio',[-.654,2,.8],'Second vehicle mesh communications radio on the opposite rail.'],
 ['Roof basket',[-.67,1.94,.5],'The common rack carries the complete roof system as one detachable assembly.'],
 ['Lightbar',[0,1.98,.13],'Roof-mounted lightbar, carried with the rack assembly.']
 ];
 document.body.classList.add('progressive-labels');
 stage.append($('details'));$('details').setAttribute('tabindex','-1');
 const groups=[
 {name:'Vision',p:[0,2.02,-.18],items:[0,3],description:'RGB and thermal PTZ observation, with a vehicle-carried reconnaissance drone for additional viewpoints. The tethered sensing & relay drone shown in the Mesh Network tab provides elevated camera coverage.'},
 {name:'Acoustic sensing',p:[.55,1.96,1.91],items:[1,2],description:'Trained to recognize drone noise, breaking glass, and gunshots, and cue camera verification. Sound detected → camera directed → RGB/thermal verification → operator alert.'},
 {name:'Mesh communications',p:[.654,2,.8],items:[7,8],description:'Two mesh radios connect the vehicle with other vehicles, fixed sensor nodes, and the command center. The tethered sensing & relay drone shown in the Mesh Network tab provides an elevated wireless relay.'},
 {name:'Compute & power',p:[.2,1.90,.8],items:[5,6,4,9,10],description:'Onboard edge compute orchestrates sensor workflows. Battery power, docking hardware, and the common rack form one deployable assembly.'}
 ];
 let labels=[],selectedGroup=null,allComponents=false;
 const groupNav=document.createElement('button');groupNav.id='viewer-back-groups';groupNav.textContent='← Back to groups';groupNav.hidden=true;stage.append(groupNav);
 const detailBack=document.createElement('button');detailBack.id='details-back-groups';detailBack.textContent='← Back to groups';detailBack.hidden=true;$('details').append(detailBack);
 function backToGroups(){selectedGroup=null;allComponents=false;$('details').hidden=true;rebuild();}
 groupNav.onclick=backToGroups;detailBack.onclick=backToGroups;

 let detailAnchor=null,lastPick=null;
 const detailGuide=document.createElementNS('http://www.w3.org/2000/svg','svg');detailGuide.id='detail-guide';detailGuide.setAttribute('aria-hidden','true');stage.append(detailGuide);
 const guideLine=document.createElementNS(detailGuide.namespaceURI,'line');detailGuide.append(guideLine);
 const guideDot=document.createElementNS(detailGuide.namespaceURI,'circle');guideDot.setAttribute('r','4');detailGuide.append(guideDot);
 function positionDetails(){
 const card=$('details');if(card.hidden||!detailAnchor){detailGuide.style.display='none';return;}
 const point=detailAnchor.point.clone();if(detailAnchor.object)detailAnchor.object.localToWorld(point);else point.y+=rack.position.y-rackY;
 point.project(camera);const w=stage.clientWidth,h=stage.clientHeight,x=(point.x*.5+.5)*w,y=(-point.y*.5+.5)*h;
 const cw=card.offsetWidth,ch=card.offsetHeight;let left=x+22;if(left+cw>w-10)left=x-cw-22;
 left=THREE.MathUtils.clamp(left,10,Math.max(10,w-cw-10));const top=THREE.MathUtils.clamp(y-ch*.35,58,Math.max(58,h-ch-10));
 card.style.left=left+'px';card.style.top=top+'px';
 const visible=point.z>-1&&point.z<1&&x>=0&&x<=w&&y>=0&&y<=h;detailGuide.style.display=visible?'':'none';
 guideLine.setAttribute('x1',x);guideLine.setAttribute('y1',y);guideLine.setAttribute('x2',THREE.MathUtils.clamp(x,left,left+cw));guideLine.setAttribute('y2',THREE.MathUtils.clamp(y,top+8,top+ch-8));guideDot.setAttribute('cx',x);guideDot.setAttribute('cy',y);
 }
 function showDetails(name,description,anchor){detailAnchor=anchor;$('details').hidden=false;$('details').querySelector('h3').textContent=name;$('details').querySelector('p').textContent=description;positionDetails();$('details').focus({preventScroll:true});}
 function makeLabel(name,p,action,isGroup=false){const el=document.createElement('button');el.className='annotation'+(isGroup?' group-label':'');el.textContent=name;el.setAttribute('aria-label',name+(isGroup?' — explore components':' — component details'));$('annotations').append(el);const line=document.createElementNS('http://www.w3.org/2000/svg','line');$('leaders').append(line);el.onclick=action;return{el,line,p:new THREE.Vector3(...p)};}
 function rebuild(){
 $('annotations').replaceChildren();$('leaders').replaceChildren();labels=[];
 $('all-components').textContent=allComponents?'Show groups':'Show all components';$('all-components').setAttribute('aria-pressed',String(allComponents));
 const expanded=selectedGroup!==null||allComponents;
 $('back-groups').hidden=!expanded;groupNav.hidden=!expanded;detailBack.hidden=!expanded;
 if(allComponents||selectedGroup!==null){const ids=allComponents?labelData.map((_,i)=>i):groups[selectedGroup].items;ids.forEach(i=>{const [name,p,description]=labelData[i];labels.push(makeLabel(name,p,()=>showDetails(name,description,{point:new THREE.Vector3(...p)})));});}
 else groups.forEach((g,i)=>labels.push(makeLabel(g.name,g.p,()=>{selectedGroup=i;showDetails(g.name,g.description,{point:new THREE.Vector3(...g.p)});rebuild();},true)));
 }
 $('all-components').onclick=()=>{allComponents=!allComponents;selectedGroup=null;$('details').hidden=true;rebuild();};
 $('back-groups').onclick=backToGroups;
 rebuild();
 // Picking is independent of label visibility and uses the closest visible surface.
 function componentIndex(name){
 const n=name.toLowerCase().replace(/[ _]+/g,' ');
 if(n.includes('epm'))return 4;
 if(n.startsWith('recon')||n.startsWith('oak'))return 3;
 if(n.startsWith('pod front-left'))return 1;
 if(n.startsWith('pod rear-right'))return 2;
 if(/^(base mounting|base ptz|main structure|pan rotation|front camera|rear camera|side case bolt|ptz basket)/.test(n))return 0;
 if(n.startsWith('recomputer'))return 6;
 if(/battery|positive-|negative-/.test(n))return 5;
 if(n.startsWith('opposite'))return 8;
 if(/^(basebox|cover reinforcing|led |lower access|main housing|side retaining|status labels|upper cover|upper protective|side rail clamp)/.test(n))return 7;
 if(n.includes('lightbar'))return 10;
 if(/roof basket|usrooffoot|usroofstandoff/.test(n))return 9;
 return null;
 }
 const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
 function pick(clientX,clientY){if(!root)return null;const r=canvas.getBoundingClientRect();pointer.set((clientX-r.left)/r.width*2-1,-(clientY-r.top)/r.height*2+1);scene.updateMatrixWorld(true);raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObject(root,true)[0];if(!hit)return null;const index=componentIndex(hit.object.name);lastPick=index===null?null:{object:hit.object,point:hit.object.worldToLocal(hit.point.clone())};return index===null?null:index;}
 let gesture=null;const activePointers=new Set();
 canvas.addEventListener('pointerdown',e=>{activePointers.add(e.pointerId);if(activePointers.size>1){gesture=null;return;}if(e.button===0)gesture={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};});
 canvas.addEventListener('pointermove',e=>{if(gesture&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>6)gesture.moved=true;if(e.pointerType==='mouse'&&!e.buttons)canvas.style.cursor=pick(e.clientX,e.clientY)!==null?'pointer':'grab';});
 canvas.addEventListener('pointerup',e=>{const click=gesture&&gesture.id===e.pointerId&&!gesture.moved&&activePointers.size===1;activePointers.delete(e.pointerId);gesture=null;if(!click)return;const i=pick(e.clientX,e.clientY);if(i!==null)showDetails(labelData[i][0],labelData[i][2],lastPick);});
 canvas.addEventListener('pointercancel',e=>{activePointers.delete(e.pointerId);gesture=null;});
 canvas.addEventListener('pointerleave',()=>{canvas.style.cursor='grab';});
 // Screen-space diagnostics for verifying actual surface hits after orbit/lift.
 window.componentTargets=()=>{if(!root)return [];const r=canvas.getBoundingClientRect(),out=[];root.updateMatrixWorld(true);root.traverse(o=>{if(!o.isMesh)return;const i=componentIndex(o.name);if(i===null)return;const v=new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).project(camera);const x=r.left+(v.x*.5+.5)*r.width,y=r.top+(-v.y*.5+.5)*r.height;if(v.z>-1&&v.z<1&&pick(x,y)===i)out.push({index:i,name:labelData[i][0],x,y});});return out;};
 function reset(){controls.target.set(0,lifted?2:1.25,.55);camera.position.set(5.3,lifted?5.8:4.8,7);controls.update();}
 function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}new ResizeObserver(resize).observe(stage);resize();reset();
 $('close-details').onclick=()=>{$('details').hidden=true;};
 $('labels').onclick=()=>{labelsOn=!labelsOn;$('labels').setAttribute('aria-pressed',String(labelsOn));$('labels').textContent=labelsOn?'Labels on':'Labels off';$('annotations').hidden=!labelsOn;$('leaders').style.display=labelsOn?'':'none';};
 $('rack').onclick=()=>{lifted=!lifted;$('rack').setAttribute('aria-pressed',String(lifted));$('rack').textContent=lifted?'Mount rack':'Lift rack';$('rack-state').textContent=lifted?'Complete rack module · separated view':'';controls.target.y=lifted?2:1.25;};
 $('reset').onclick=reset;
 $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.querySelector('.visual').requestFullscreen)await document.querySelector('.visual').requestFullscreen();else $('rack-state').textContent='Use your browser’s fullscreen option.';}catch(e){$('rack-state').textContent='Fullscreen is unavailable in this browser.';}};
 document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen';resize();});
 canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const offset=camera.position.clone().sub(controls.target),sp=new THREE.Spherical().setFromVector3(offset);sp.theta+=(e.key==='ArrowLeft'?.12:e.key==='ArrowRight'?-.12:0);sp.phi=THREE.MathUtils.clamp(sp.phi+(e.key==='ArrowUp'?-.08:e.key==='ArrowDown'?.08:0),.1,Math.PI*.49);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sp));controls.update();});
 const decoder=new THREE.DRACOLoader();decoder.setDecoderPath('vendor/');const loader=new THREE.GLTFLoader();loader.setDRACOLoader(decoder);
 loader.load('assets/vehicle-rack.glb',g=>{root=g.scene;scene.add(root);rack=root.getObjectByName('RackAssembly');if(!rack){showError();return;}rackY=rack.position.y;root.traverse(o=>{if(o.isMesh){o.frustumCulled=true;if(o.material){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{if(m.metalness>.5)m.metalness=.3;});}}});$('loading').hidden=true;['rack','labels','reset','all-components'].forEach(id=>$(id).disabled=false);document.body.dataset.loaded='true';if(window.initScenario)window.initScenario({scene,root,camera,controls});decoder.dispose();},event=>{if(event.total)$('load-text').textContent=`Loading the roof system… ${Math.round(event.loaded/event.total*100)}%`;},showError);
 function showError(){$('load-text').textContent='The model could not load. Check your connection and reload the page.';document.querySelector('.spinner').hidden=true;}
 const projected=new THREE.Vector3();
 function annotations(){if(!root||!labelsOn)return;const w=stage.clientWidth,h=stage.clientHeight;const buckets=[[],[]];for(const l of labels){projected.copy(l.p);projected.y+=rack.position.y-rackY;projected.project(camera);l.x=(projected.x*.5+.5)*w;l.y=(-projected.y*.5+.5)*h;const visible=projected.z<1&&projected.z>-1&&l.x>0&&l.x<w&&l.y>0&&l.y<h;l.el.hidden=!visible;l.line.style.display=visible?'':'none';if(visible)buckets[l.x<w/2?0:1].push(l);}
 for(let side=0;side<2;side++){const list=buckets[side].sort((a,b)=>a.y-b.y),gap=w<550?34:36;let last=22;list.forEach(l=>{l.ly=Math.max(last,Math.min(h-28,l.y));last=l.ly+gap;});const overflow=list.length?Math.max(0,list[list.length-1].ly-(h-28)):0;list.forEach(l=>{l.ly-=overflow;const lw=l.el.offsetWidth;const edge=side===0?Math.min(...list.map(v=>v.x)):Math.max(...list.map(v=>v.x));const x=side===0?Math.max(10,edge-lw-45):Math.min(w-lw-10,edge+45);l.el.style.left=x+'px';l.el.style.top=l.ly+'px';l.line.setAttribute('x1',side===0?x+lw:x);l.line.setAttribute('y1',l.ly);l.line.setAttribute('x2',l.x);l.line.setAttribute('y2',l.y);});}}
 let previous=performance.now();function animate(now){requestAnimationFrame(animate);const dt=Math.min(.05,(now-previous)/1000);previous=now;if(rack){const target=rackY+(lifted?1.6:0);rack.position.y=reduced?target:THREE.MathUtils.lerp(rack.position.y,target,1-Math.exp(-5*dt));}controls.update();scene.updateMatrixWorld(true);annotations();positionDetails();renderer.render(scene,camera);}requestAnimationFrame(animate);
 // Read-only diagnostic snapshot used by browser checks.
 window.viewerState=()=>({loaded:!!rack,lifted,labelsOn,selectedGroup,allComponents,labelCount:labels.length,rackY:rack?.position.y,baseY:rackY,rackMeshes:rack?.children.length,camera:camera.position.toArray()});
})();

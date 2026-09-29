/* Optional US-only architecture preview. No model or speech-service claims. */
window.createSystemsTour=function({stage,camera,pose,bounds,example,finish}){
 const steps=[
  {title:'EDGE AI COMPUTER',image:'edge-enclosure.jpg',body:'Behind display',note:'Voice-controlled mission workflow'},
  {title:'EDGE AI · MISSION ORCHESTRATION',image:'jetson.png',body:'Onboard models · No cloud inference',note:'Two-way voice · Operator decisions',duration:12},
  {title:'360° AI-READY PTZ',body:'RGB + thermal · Automatic tracking',note:'Coordinated by the onboard mission system'},
  {title:'RECON DRONE',body:'Vehicle-carried reconnaissance',note:'Operator confirmation before launch'}
 ];
 const root=document.createElement('section');root.className='systems-tour';root.hidden=true;root.setAttribute('aria-label','Onboard systems tour');
 root.innerHTML='<div class="tour-device-label" hidden></div><div class="tour-transition"></div><article class="tour-card"><div class="tour-eyebrow">ONBOARD ARCHITECTURE · PREVIEW</div><h2></h2><img alt=""><p class="tour-body"></p><div class="tour-flow"><span>Detect</span><span>Track</span><span>Record</span><span>Ask</span></div><p class="tour-note"></p><div class="tour-example" hidden><small>SCRIPTED WORKFLOW EXAMPLE</small><p></p></div><div class="tour-count"></div><div class="tour-progress"><i></i></div><div class="tour-controls"><button type="button" class="tour-pause">PAUSE</button><button type="button" class="tour-next">NEXT</button><button type="button" class="tour-skip">SKIP TOUR</button></div></article>';
 stage.append(root);const q=s=>root.querySelector(s),card=q('.tour-card');
 const voice=createTourNarration();
 let active=false,index=0,time=0,held=false,switched=false,commandApplied=false,voiceStarted=false;
 function show(){
  voice.stop();voiceStarted=false;time=0;switched=false;commandApplied=false;const s=steps[index];
  q('h2').textContent=s.title;q('.tour-body').textContent=s.body;q('.tour-note').textContent=s.note;
  const img=q('img');img.hidden=!s.image;if(s.image){img.src='us/assets/systems-tour/'+s.image;img.alt=index===0?'Reference enclosure behind the display':'Jetson reference hardware for local model deployment';}
  q('.tour-count').textContent=`${index+1} / ${steps.length} · Vehicle parked`;
  q('.tour-example').hidden=index!==1;
  q('.tour-next').textContent=index===steps.length-1?'START PATROL':'NEXT';
 }
 function end(){if(!active)return;voice.stop();active=false;root.hidden=true;finish();}
 function next(){if(index===steps.length-1)end();else{index++;show();}}
 q('.tour-next').onclick=next;q('.tour-skip').onclick=end;
 q('.tour-pause').onclick=()=>{held=!held;if(held)voice.pause();else if(voiceStarted)voice.resume();q('.tour-pause').textContent=held?'CONTINUE':'PAUSE';};
 document.addEventListener('visibilitychange',()=>{if(active){if(document.hidden)voice.pause();else if(!held && voiceStarted)voice.resume();}});
 root.addEventListener('pointerdown',e=>e.stopPropagation());
 document.addEventListener('keydown',e=>{if(active && e.key==='Escape'){e.preventDefault();end();}});
 return {
  get active(){return active;},
  prepare(){return voice.prepare();},
  snapshot(){return {active,index,time,held,commandApplied,narration:voice.snapshot()};},
  start(){active=true;index=0;held=false;root.hidden=false;q('.tour-pause').textContent='PAUSE';show();q('.tour-next').focus();},
  update(dt){
   if(!active)return;
   if((!held && !voice.waiting) || time<.5)time+=dt;
   if(time>=.65 && !held && !voiceStarted){voiceStarted=true;voice.play(index);}
   const duration=Math.max(steps[index].duration||7,voice.duration(index)+1.3);
   if(time>=duration && voice.finished){next();if(!active)return;}
   // Opaque cuts hide cabin/roof traversal; no camera flight through bodywork.
   q('.tour-transition').style.opacity=index===1?0:time<.2?time/.2:Math.max(0,1-(time-.2)/.3);
   if(time>=.2){pose(index,!switched);switched=true;}
   if(index===1 && time>2 && !commandApplied){example();commandApplied=true;}
   if(index===1)q('.tour-example p').textContent=[
    'System: “Person detected. Tracking and recording.”',
    'System: “Clip ready. Send to command center?”',
    'Operator: “Send it.”',
    'System: “Clip sent.”'
   ][Math.min(3,Math.floor(time/3))];
   q('.tour-progress i').style.width=Math.min(100,time/duration*100)+'%';
   q('.tour-flow').hidden=index!==1;
   [...root.querySelectorAll('.tour-flow span')].forEach((el,i)=>el.classList.toggle('active',index===1 && i===Math.min(3,Math.floor(time/1.1))));
   const label=q('.tour-device-label'),device=index>=2?bounds(index):null;
   label.hidden=!switched || !device || time<.5;
   if(!label.hidden){
    label.textContent=index===2?'360° PTZ':'RECON DRONE';
    const r=stage.getBoundingClientRect(),w=label.offsetWidth,h=label.offsetHeight;
    const beside=index===2 && device.left*r.width>w+22;
    const x=Math.max(10,Math.min(r.width-w-10,beside?device.left*r.width-w-12:(device.left+device.right)*.5*r.width-w/2));
    const y=Math.max(60,beside?(device.top+device.bottom)*.5*r.height-h/2:device.top*r.height-h-12);
    label.style.left=x+'px';label.style.top=y+'px';
   }
  }
 };
};

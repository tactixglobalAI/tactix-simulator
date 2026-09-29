/* Bundled guide voice. A single source prevents overlapping tour clips. */
window.createTourNarration=function(){
 const names=['Edge computer','Mission orchestration','PTZ','Recon drone'];
 let context,promise,source,index=0,offset=0,started=0,generation=0,waiting=false,finished=false,error=null,paused=false;
 const buffers=[],history=[];
 function halt(reason){
  if(!source)return;
  offset+=context.currentTime-started;
  source.onended=null;source.stop();source.disconnect();source=null;
  const entry=history[history.length-1];entry.end=performance.now();entry.reason=reason;
 }
 async function prepare(){
  if(!context)context=new (window.AudioContext||window.webkitAudioContext)();
  await context.resume();
  if(!promise)promise=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
   try{
    const response=await fetch('us/audio/tour/manifest.json?v=3',{signal:controller.signal});if(!response.ok)throw Error('Tour voice manifest unavailable');
    const manifest=await response.json();
    await Promise.all(names.map(async(name,i)=>{
     const response=await fetch(manifest.clips[name].file,{signal:controller.signal});if(!response.ok)throw Error('Tour voice clip unavailable');
     buffers[i]=await context.decodeAudioData(await response.arrayBuffer());
    }));
   }finally{clearTimeout(timer);}
  })();
  return promise;
 }
 function resume(){
  paused=false;
  if(!buffers[index] || finished || source)return;
  if(context.state!=='running'){context.resume().then(resume).catch(e=>{error=e.message;finished=true;});return;}
  source=context.createBufferSource();source.buffer=buffers[index];source.connect(context.destination);started=context.currentTime;
  const current=source,entry={index,start:performance.now(),end:null};history.push(entry);
  source.onended=()=>{if(source!==current)return;source.disconnect();source=null;finished=true;entry.end=performance.now();entry.reason='ended';};
  source.start(0,Math.min(offset,buffers[index].duration));
 }
 return {
  prepare(){return prepare().catch(e=>{error=e.message;});},
  async play(i){halt('next');const token=++generation;index=i;offset=0;finished=false;paused=false;waiting=true;
   try{await prepare();if(token!==generation)return;waiting=false;if(!paused)resume();}
   catch(e){if(token===generation){waiting=false;finished=true;error=e.message;}}
  },
  pause(){paused=true;halt('pause');},resume,
  stop(){generation++;halt('stop');waiting=false;finished=true;},
  duration(i){return buffers[i]?.duration||0;},
  get waiting(){return waiting;},get finished(){return finished;},
  snapshot(){return {index,playing:!!source,waiting,finished,error,offset,history:history.map(v=>({...v})),loaded:buffers.filter(Boolean).length};}
 };
};

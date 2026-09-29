/* Deterministic, instanced refinery access road. Metres; right-hand traffic. */
window.buildUSIndustrialEnvironment=(scene)=>{
 let seed=28619;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const group=new THREE.Group();group.name='RefineryAccessRoad';scene.add(group);
 const mat=(color,roughness=.85,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
 const steel=mat(0x646f72,.57,.45),dark=mat(0x323d40,.75,.3),concrete=mat(0x68706a),rust=mat(0x58483a),tankMat=mat(0x899491,.68,.25);
 const batches=new Map(),boxGeo=new THREE.BoxGeometry(1,1,1),cylinderGeo=new THREE.CylinderGeometry(1,1,1,16),sphereGeo=new THREE.SphereGeometry(1,16,8),ringGeo=new THREE.TorusGeometry(1,.022,5,24);
 const temp=new THREE.Object3D();
 function instance(geo,material,pos,scale,rotation=[0,0,0]){
  let byMaterial=batches.get(geo);if(!byMaterial)batches.set(geo,byMaterial=new Map());
  let list=byMaterial.get(material);if(!list)byMaterial.set(material,list=[]);
  temp.position.set(...pos);temp.scale.set(...scale);temp.rotation.set(...rotation);temp.updateMatrix();list.push(temp.matrix.clone());
 }
 const box=(m,p,s,r)=>instance(boxGeo,m,p,s,r),cyl=(m,p,r,h)=>instance(cylinderGeo,m,p,[r,h,r]);
 function beam(m,start,end,width=.06){
  const a=new THREE.Vector3(...start),b=new THREE.Vector3(...end),delta=b.clone().sub(a);
  temp.position.copy(a.add(b).multiplyScalar(.5));temp.scale.set(width,delta.length(),width);temp.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());temp.updateMatrix();
  let by=batches.get(boxGeo);if(!by)batches.set(boxGeo,by=new Map());if(!by.has(m))by.set(m,[]);by.get(m).push(temp.matrix.clone());
 }
 function texture(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const ctx=canvas.getContext('2d'),im=ctx.createImageData(512,512);
  for(let y=0;y<512;y++)for(let x=0;x<512;x++){
   const i=(y*512+x)*4,v=45+random()*15+3*Math.sin(x*.044)*Math.sin(y*.028);
   im.data[i]=v;im.data[i+1]=v+1;im.data[i+2]=v+2;im.data[i+3]=255;
  }ctx.putImageData(im,0,0);ctx.strokeStyle='rgba(13,17,19,.45)';ctx.lineWidth=.8;
  for(let n=0;n<8;n++){let x=random()*512,y=random()*512;ctx.beginPath();ctx.moveTo(x,y);for(let i=0;i<7;i++){x+=(random()-.5)*35;y+=random()*22;ctx.lineTo(x,y);}ctx.stroke();}
  const map=new THREE.CanvasTexture(canvas);map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(2,150);map.encoding=THREE.sRGBEncoding;map.anisotropy=4;return map;
 }
 const roadCenter=-1.85,roadWidth=7.4;
 const asphalt=new THREE.MeshStandardMaterial({map:texture(),roughness:.9,color:0xcbd0d2});
 function plane(name,width,length,x,y,z,material){const o=new THREE.Mesh(new THREE.PlaneGeometry(width,length),material);o.name=name;o.rotation.x=-Math.PI/2;o.position.set(x,y,z);o.receiveShadow=true;group.add(o);return o;}
 plane('IndustrialTerrain',1600,1600,0,-.045,-300,mat(0x353c32));
 plane('GravelShoulders',9.4,600,roadCenter,-.012,-250,mat(0x565a53));
 plane('TwoLaneAsphalt',roadWidth,600,roadCenter,0,-250,asphalt);
 const yellow=mat(0xb6a467),white=mat(0xa7aaa0);
 for(let z=43;z>-548;z-=9)plane('WornCenterDash',.11,3,roadCenter,.009,z,yellow);
 for(const x of [roadCenter-roadWidth/2+.17,roadCenter+roadWidth/2-.17])plane('RoadEdgeLine',.10,600,x,.009,-250,white);
 // Tire-darkened paths and modest repairs avoid a pristine uniform road surface.
 const tire=new THREE.MeshStandardMaterial({color:0x151b1e,transparent:true,opacity:.13,depthWrite:false,roughness:1});
 for(const x of [-4.45,-2.95,-.75,.75])plane('TireWear',.34,600,x,.004,-250,tire);
 for(let n=0;n<24;n++)plane('AsphaltRepair',.4+random()*1.1,1+random()*2,roadCenter+(random()-.5)*5,.005,-12-random()*470,mat(0x292e2d));
 for(let z=4;z>-340;z-=24){box(concrete,[2.45,-.03,z],[.45,.10,1.1]);box(dark,[2.45,.025,z],[.30,.012,.65]);}
 // Security fences: sparse mesh lines, posts and rails; no opaque billboard wall.
 const lines=[];const line=(a,b)=>lines.push(...a,...b);
 for(const x of [-12,12])for(let z=35;z>-385;z-=7){
  cyl(dark,[x,1.25,z],.045,2.5);
  beam(steel,[x,2.28,z],[x,2.28,z-7],.035);
  beam(steel,[x,.3,z],[x,.3,z-7],.028);
  for(let zz=z;zz>z-7;zz-=.45){line([x,.3,zz],[x,2.28,zz-1]);line([x,.3,zz-1],[x,2.28,zz]);}
 }
 // Utility poles and sagging conductors provide human-scale roadside detail.
 for(const x of [-7.1,4.3])for(let z=x>0?12:22;z>-365;z-=30){
  cyl(rust,[x,5.2,z],.12,10.4);box(dark,[x,9.6,z],[2.5,.14,.16]);
  for(const dx of [-.95,0,.95]){
   cyl(steel,[x+dx,9.82,z],.08,.30);
   for(let j=0;j<12;j++){const t=j/12,u=(j+1)/12;line([x+dx,10.02-.65*Math.sin(Math.PI*t),z-30*t],[x+dx,10.02-.65*Math.sin(Math.PI*u),z-30*u]);}
  }
 }
 const amber=new THREE.MeshBasicMaterial({color:0xf6d29d});
 for(let z=-7;z>-330;z-=45){
  cyl(dark,[-5.95,3.75,z],.07,7.5);beam(dark,[-5.95,7.45,z],[-4.95,7.60,z],.09);box(steel,[-4.9,7.56,z],[.55,.13,.26]);box(amber,[-4.9,7.48,z],[.40,.015,.19]);
 }
 // Tanks, fractionation columns, service platforms, pipe racks and support steel.
 for(let i=0;i<18;i++){
  const side=i%2?1:-1,x=side*(20+random()*29),z=-30-Math.floor(i/2)*42-random()*16;
  const height=15+random()*27,radius=.75+random()*.65;
  box(concrete,[x,.28,z],[radius*4,.55,radius*4]);cyl(tankMat,[x,height/2+.55,z],radius,height);
  instance(sphereGeo,tankMat,[x,height+.55,z],[radius,.55,radius]);
  for(let y=4;y<height;y+=5){
   instance(ringGeo,steel,[x,y,z],[radius+ .38,radius+.38,radius+.38],[Math.PI/2,0,0]);
   instance(ringGeo,dark,[x,y+.85,z],[radius+.38,radius+.38,radius+.38],[Math.PI/2,0,0]);
   for(let a=0;a<6;a++){const t=a*Math.PI/3;cyl(dark,[x+Math.cos(t)*(radius+.38),y+.42,z+Math.sin(t)*(radius+.38)],.025,.85);}
  }
  for(const dx of [-.20,.20])beam(dark,[x+dx,1,z-radius-.23],[x+dx,height,z-radius-.23],.035);
  for(let y=1;y<height;y+=.38)beam(steel,[x-.20,y,z-radius-.23],[x+.20,y,z-radius-.23],.025);
  const tx=x+side*7;
  cyl(tankMat,[tx,3.6,z+10],4,7);instance(sphereGeo,tankMat,[tx,7.1,z+10],[4,.65,4]);
  for(let n=0;n<3;n++){
   const px=x+side*(3+n*.6);beam(steel,[px,.5,z-9],[px,7+n*.4,z-9],.25);beam(steel,[px,7+n*.4,z-9],[px,7+n*.4,z+18],.25);
  }
  for(const zz of [z-9,z+5,z+18]){box(dark,[x+side*4,3,zz],[.16,6,.16]);box(dark,[x+side*4,6,zz],[4,.2,.2]);}
 }
 // Low service buildings and long pipe gantries beyond the contact/reveal area.
 for(let i=0;i<7;i++){
  const x=i%2?29:-28,z=-65-i*43;box(mat(0x515c5b),[x,2.5,z],[12,5,16]);box(steel,[x,5.08,z],[12.3,.16,16.3]);
  for(let n=0;n<5;n++)box(dark,[x+(i%2?-6.02:6.02),2.8,z-5+n*2.5],[.04,1.5,1.2]);
 }
 for(const z of [-170,-285]){for(const x of [-10,8])box(dark,[x,5,z],[.25,10,.25]);box(steel,[-1,9.8,z],[18,.25,.4]);for(let n=0;n<3;n++)beam(steel,[-12,10.2+n*.45,z],[12,10.2+n*.45,z],.25);}
 const wireGeo=new THREE.BufferGeometry();wireGeo.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));group.add(new THREE.LineSegments(wireGeo,new THREE.LineBasicMaterial({color:0x343d40,transparent:true,opacity:.58})));
 for(const [geometry,materials] of batches)for(const [material,matrices] of materials){
  const mesh=new THREE.InstancedMesh(geometry,material,matrices.length);matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.castShadow=false;mesh.receiveShadow=true;group.add(mesh);
 }
 return {group,roadCenter,laneCenter:0,laneWidth:3.7,roadWidth};
};

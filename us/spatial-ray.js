/* Static triangle BVH for boolean sightline tests; no rendering geometry changes. */
window.TactixSightline=(()=>{
 const cache=new WeakMap(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),hit=new THREE.Vector3();
 function build(geometry){
  if(cache.has(geometry))return cache.get(geometry);
  const p=geometry.attributes.position,ix=geometry.index,n=(ix?ix.count:p.count)/3;
  const bounds=new Float32Array(n*6),ids=[];
  const vertex=i=>ix?ix.getX(i):i;
  for(let t=0;t<n;t++){
   ids.push(t);a.fromBufferAttribute(p,vertex(t*3));b.fromBufferAttribute(p,vertex(t*3+1));c.fromBufferAttribute(p,vertex(t*3+2));
   bounds.set([Math.min(a.x,b.x,c.x),Math.min(a.y,b.y,c.y),Math.min(a.z,b.z,c.z),Math.max(a.x,b.x,c.x),Math.max(a.y,b.y,c.y),Math.max(a.z,b.z,c.z)],t*6);
  }
  function node(list,depth=0){
   const box=new THREE.Box3();
   for(const t of list){a.fromArray(bounds,t*6);b.fromArray(bounds,t*6+3);box.expandByPoint(a);box.expandByPoint(b);}
   if(list.length<=20 || depth>32)return {box,list};
   const size=box.getSize(new THREE.Vector3()),axis=size.x>size.y?(size.x>size.z?0:2):(size.y>size.z?1:2);
   const mid=(box.min.getComponent(axis)+box.max.getComponent(axis))/2,left=[],right=[];
   for(const t of list)((bounds[t*6+axis]+bounds[t*6+axis+3])/2<mid?left:right).push(t);
   if(!left.length || !right.length)return {box,list};
   return {box,left:node(left,depth+1),right:node(right,depth+1)};
  }
  const root=node(ids),result={blocked(ray,far){
   function visit(n){
    if(!ray.intersectsBox(n.box))return false;
    if(!n.list)return visit(n.left)||visit(n.right);
    for(const t of n.list){a.fromBufferAttribute(p,vertex(t*3));b.fromBufferAttribute(p,vertex(t*3+1));c.fromBufferAttribute(p,vertex(t*3+2));
     if(ray.intersectTriangle(a,b,c,false,hit)){const d=hit.distanceTo(ray.origin);if(d>.02 && d<far)return true;}
    }return false;
   }return visit(root);
  }};cache.set(geometry,result);return result;
 }
 function opaque(mesh){const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];return mats.some(m=>m && !(m.transparent && m.opacity<.5));}
 function prepare(root){root.traverse(o=>{if(o.isMesh && opaque(o))build(o.geometry);});}
 function blocked(root,origin,target){
  let result=false;root.updateMatrixWorld(true);
  root.traverseVisible(o=>{
   if(result || !o.isMesh || !opaque(o))return;
   const inverse=o.matrixWorld.clone().invert(),start=origin.clone().applyMatrix4(inverse),end=target.clone().applyMatrix4(inverse),delta=end.sub(start),far=delta.length()-.1;
   result=build(o.geometry).blocked(new THREE.Ray(start,delta.normalize()),far);
  });return result;
 }
 return {prepare,blocked,build};
})();

/* Reuse the actual roof drone, including its camera; keep the EPM dock in place. */
window.deployRoofDrone=(vehicle,parent,target)=>{
 vehicle.updateMatrixWorld(true);parent.updateMatrixWorld(true);
 const originals=[];vehicle.traverse(o=>{if(o.isMesh&&/^(Recon[ _]Drone|ReconCamera|OAK)/i.test(o.name))originals.push(o);});
 const flight=new THREE.Group();flight.name='Deployed roof drone';parent.add(flight);
 const inverse=new THREE.Matrix4().copy(parent.matrixWorld).invert();
 for(const source of originals){const clone=source.clone();clone.visible=true;clone.matrix.copy(inverse).multiply(source.matrixWorld);clone.matrix.decompose(clone.position,clone.quaternion,clone.scale);flight.add(clone);source.visible=false;}
 const bounds=new THREE.Box3().setFromObject(flight),center=bounds.getCenter(new THREE.Vector3());parent.worldToLocal(center);
 flight.position.copy(new THREE.Vector3(...target).sub(center));
 return {flight,count:originals.length,restore(){originals.forEach(o=>o.visible=true);parent.remove(flight);}};
};

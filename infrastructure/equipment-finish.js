/* Neutral aluminum finishes with contrasting mounting hardware. */
window.applyEquipmentFinish=root=>root.traverse(o=>{
 if(!o.isMesh)return;
 const name=o.name.toLowerCase().replace(/_/g,' ');
 let color;
 if(name.startsWith('recomputer'))color='#8195a3';
 else if(name.startsWith('battery-casing'))color='#a4afb7';
 else if(name.startsWith('battery flat mounting'))color='#354653';
 else return;
 const finish=m=>{const copy=m.clone();copy.color.set(color).convertSRGBToLinear();copy.metalness=.3;copy.roughness=.48;return copy;};
 o.material=Array.isArray(o.material)?o.material.map(finish):finish(o.material);
});

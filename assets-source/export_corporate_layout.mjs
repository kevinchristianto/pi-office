/** Actual TypeScript scene export for immutable-GLB Blender reviews.
 * Run only after the runtime geometry/controller is frozen:
 *   node assets-source/export_corporate_layout.mjs
 * No GLB, character anatomy, or historical Blender source is modified.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';
const base=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Real temporary ES modules permit cyclic runtime dependencies and JSON manifests.
// They are transpiled from this checkout, never substituted with review-only logic.
const moduleDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'pi-office-layout-'));
const moduleUrls=new Map();
function moduleUrl(name){
  const filename=path.isAbsolute(name)?name:path.join(base,'src',name);
  if(moduleUrls.has(filename))return moduleUrls.get(filename);
  const output=path.join(moduleDirectory,`${moduleUrls.size}.mjs`);
  const url=pathToFileURL(output).href;moduleUrls.set(filename,url);
  if(filename.endsWith('.json')){
    fs.writeFileSync(output,'export default '+fs.readFileSync(filename,'utf8')+';\n');
    return url;
  }
  let js=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const imports=[...js.matchAll(/\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g)];
  for(const match of imports){
    let dependency=path.resolve(path.dirname(filename),match[1]).replace(/\.js$/,'.ts');
    if(!path.extname(dependency))dependency+='.ts';
    js=js.replaceAll(match[0],`from ${JSON.stringify(moduleUrl(dependency))}`);
  }
  fs.writeFileSync(output,js);return url;
}
const load=async name=>import(moduleUrl(name));
const [world,decor,appearance,entranceDecor,lifecycleRoutes,lifecycleWalking,motion]=await Promise.all(['world.ts','officeDecor.ts','appearance.ts','entranceDecor.ts','lifecycleRoutes.ts','lifecycleWalking.ts','motion.ts'].map(load));
const officeSource=fs.readFileSync(path.join(base,'src/Office.tsx'),'utf8');
const chairMatch=officeSource.match(/centers\.meeting\[1\]\s*\+\s*side\s*\*\s*([.\d]+)/);
if(!chairMatch)throw new Error('SharedWorkplace meeting chair position changed; update snapshot mapping.');
const meetingChairOffset=Number(chairMatch[1]);
const names=['Platform Engineering','Product & Design','Research & Data','Customer Operations'];
const clips=['Work','ThinkSeated','WaitSeated','IdleSeated','ErrorSeated','DoneSeated'];
const fixtureIds=Array.from({length:8},(_,variant)=>{
  for(let n=0;n<1000;n++){const id=`review-resident-${n}`;if(appearance.residentVariant(id)===variant)return id;}
  throw new Error('Could not resolve resident fixture');
});
const scenes={};
for(const count of [1,4]){
  const sections=Array.from({length:count},(_,i)=>({id:`review-project-${i+1}`,name:names[i],agentCount:6}));
  const rooms=world.createOfficeLayout(sections),facilities=world.createFacilityLayout(count),bounds=world.buildingLayoutBounds(count);
  const centers={meeting:facilities.zones.meeting.center,reception:facilities.zones.reception.center,breakroom:facilities.zones.pantry.center,operations:facilities.zones.print.center};
  const solids=rooms.flatMap(decor.createRoomDecor);
  const width=bounds.maxX-bounds.minX,depth=bounds.maxZ-bounds.minZ,centerX=(bounds.minX+bounds.maxX)/2,centerZ=(bounds.minZ+bounds.maxZ)/2;
  solids.push({name:'Building podium',position:[centerX,-.27,centerZ],size:[width+3,.15,depth+3],color:'#b4c0c8'});
  solids.push({name:'Shared facility floor',position:[(facilities.bounds.minX+facilities.bounds.maxX)/2,-.01,(facilities.bounds.minZ+facilities.bounds.maxZ)/2],size:[facilities.bounds.maxX-facilities.bounds.minX,.06,facilities.bounds.maxZ-facilities.bounds.minZ],color:'#c3ccd0'});
  solids.push({name:'Shared circulation stripe',position:[0,.031,facilities.circulation[0][1]],size:[facilities.bounds.maxX-facilities.bounds.minX-1.2,.008,.08],color:'#4b7685'});
  solids.push(...decor.createAmenityDecor(centers),...entranceDecor.createEntranceDecor(count));
  const assets=[],residents=[],labels=[];
  for(const room of rooms){
    const [x,z]=room.center;
    assets.push({name:'plant',position:[x-5.35,.05,z-4.25],scale:.8},{name:'plant',position:[x+5.35,.05,z-4.25],scale:.8});
    labels.push({text:sections[room.index].name.toUpperCase(),position:[x,2.62,z-4.82],size:.155,kind:'department'});
    for(const d of room.desks){
      assets.push({name:'desk',position:[d.desk[0],.04,d.desk[1]],rotation:d.orientation},{name:'chair',position:[d.seat[0],.04,d.seat[1]],rotation:d.orientation});
      const variant=(room.index*6+d.index)%8,id=fixtureIds[variant];
      residents.push({name:path.basename(appearance.residentModel(id),'.glb'),id,position:[d.seat[0],appearance.RESIDENT_SEATED_Y,d.seat[1]],rotation:d.orientation,clip:clips[d.index],roomIndex:room.index,deskIndex:d.index});
    }
  }
  for(const dx of [-.7,.7])for(const side of [-1,1])assets.push({name:'chair',position:[centers.meeting[0]+dx,.04,centers.meeting[1]+side*meetingChairOffset],rotation:side===1?0:Math.PI});
  assets.push({name:'chair',position:[centers.reception[0]+.5,.04,centers.reception[1]-.8],rotation:Math.PI});
  assets.push({name:'plant',position:[facilities.bounds.minX+.4,.04,facilities.bounds.maxZ-.5],scale:1.1},{name:'plant',position:[facilities.bounds.maxX-.4,.04,facilities.bounds.maxZ-.5],scale:1.1});
  for(const [key,text] of Object.entries({meeting:'01   PROJECT ROOM',reception:'PI OFFICE',breakroom:'03   BREAK & PRINT',operations:'02   OPERATIONS'}))labels.push({text,position:[centers[key][0],key==='operations'?2.7:2.15,centers[key][1]],size:.14,kind:'facility'});
  const entrance=world.createBuildingEntranceLayout(count);
  labels.push({text:'PI OFFICE  /  ENTRANCE',position:[entrance.threshold[0],2.87,entrance.threshold[1]+.081],size:.145,kind:'entrance'});
  scenes[count===1?'detail':'overview']={sections,rooms,facilities,entrance,bounds,solids,assets,residents,labels};
}
// Exact shared state-machine samples: 60 Hz runtime simulation, 12 fps review.
// Only presentation mapping (same yaw easing and pose selection as Office.tsx)
// is mirrored here; positions, phase advancement and speed come from the imports.
function exportWalkingReview(scene){
  const room=scene.rooms[0],desk=room.desks[5];
  const resident=scene.residents.find(r=>r.roomIndex===room.index&&r.deskIndex===desk.index);
  const route=lifecycleRoutes.createBuildingEntryRoute(scene.rooms,room,desk,0);
  const total=world.routeLength(route),speed=lifecycleRoutes.LIFECYCLE_WALK_SPEED;
  const fps=12,simulationHz=60,dt=1/simulationHz,crossfadeSeconds=.2,workSeconds=1.5,endHoldSeconds=.5;
  if(!/fadeOut\(0\.2\)/.test(officeSource)||!/fadeIn\(0\.2\)/.test(officeSource))throw new Error('Runtime clip crossfade changed; update review mapping.');
  const reservations=new Map();let life=lifecycleWalking.createLifecycleWalk('arriving',total);
  let stage='arrival',time=0,workStarted=null,finishedAt=null,yaw=lifecycleRoutes.sampleLifecycleRoutePose(route,0).yaw,currentClip='Idle',clipStarted=0,previousClip=null,previousStarted=0,clipChangeAt=0;
  const samples=[],events=[];
  function record(){
    const walking=life?.phase==='walking';
    const seated=stage==='work'||life?.phase==='seating'||(life?.phase==='waiting'&&life.direction==='exiting')||(life?.phase==='settled'&&life.direction==='arriving');
    const pose=life?lifecycleRoutes.sampleLifecycleRoutePose(route,life.distance):{position:desk.seat,yaw:desk.orientation};
    const visible=stage!=='finished'&&!(life?.phase==='waiting'&&life.direction==='arriving');
    const blend=previousClip?Math.min(1,Math.max(0,(time-clipChangeAt)/crossfadeSeconds)):1;
    return {frame:samples.length+1,time,stage,direction:life?.direction??null,phase:life?.phase??'working',distance:life?.distance??total,position:[pose.position[0],seated?appearance.RESIDENT_SEATED_Y:appearance.RESIDENT_STANDING_Y,pose.position[1]],yaw,visible,scale:1,clip:currentClip,clipTime:Math.max(0,time-clipStarted)*motion.animationPlaybackRate(currentClip),blendFrom:blend<1?previousClip:null,blendFromTime:Math.max(0,time-previousStarted)*motion.animationPlaybackRate(previousClip??'Idle'),blend};
  }
  samples.push(record());
  for(let tick=1;tick<simulationHz*180;tick++){
    time=tick*dt;
    if(stage==='work'&&time-workStarted>=workSeconds){stage='departure';life=lifecycleWalking.createLifecycleWalk('exiting',total);events.push({time,event:'departure'});}
    if(life&&stage!=='finished'){
      const before=life.phase,complete=lifecycleWalking.stepLifecycleWalk(life,dt,total,speed,room.id,resident.id,reservations);
      if(before!==life.phase)events.push({time,event:life.phase,direction:life.direction,distance:life.distance});
      if(complete==='arriving'){stage='work';workStarted=time;life=null;events.push({time,event:'work'});}
      else if(complete==='exiting'){stage='finished';finishedAt=time;events.push({time,event:'offsite'});}
    }
    const walking=life?.phase==='walking';
    const seated=stage==='work'||life?.phase==='seating'||(life?.phase==='waiting'&&life.direction==='exiting')||(life?.phase==='settled'&&life.direction==='arriving');
    if(walking||life?.phase==='standing'){
      const pose=lifecycleRoutes.sampleLifecycleRoutePose(route,life.distance);
      const target=pose.yaw+(life.direction==='exiting'?Math.PI:0);
      yaw=motion.stepHeading(yaw,target,dt);
    } else if(seated)yaw=motion.stepHeading(yaw,desk.orientation,dt);
    const clip=walking?'Walk':seated?'Work':'Idle';
    if(clip!==currentClip){previousClip=currentClip;previousStarted=clipStarted;currentClip=clip;clipStarted=time-dt;clipChangeAt=time-dt;events.push({time,event:'clip',clip});}
    if(tick%(simulationHz/fps)===0)samples.push(record());
    if(finishedAt!==null&&time-finishedAt>=endHoldSeconds)break;
  }
  if(finishedAt===null)throw new Error('Shared lifecycle did not complete the review within its guard.');
  const review={residentId:resident.id,model:resident.name,roomIndex:room.index,deskIndex:desk.index,queueIndex:0,route,routeLength:total,speed,fps,simulationHz,poseSeconds:lifecycleWalking.LIFECYCLE_POSE_SECONDS,crossfadeSeconds,walkGaitRate:motion.WALK_GAIT_RATE,turnSpeedRadiansPerSecond:motion.WALK_TURN_SPEED,workSeconds,events,samples,duration:samples.length/fps,disclosure:'Blender visualization of the shared runtime natural-navigation route/controller at actual brisk speed, with original authored GLB clips and true pose blending. This is not a browser capture.'};
  console.log(`Walking review: ${total.toFixed(3)} units each way at ${speed} units/sec; ${samples.length} frames / ${review.duration.toFixed(2)} seconds at ${fps} fps.`);
  return review;
}
scenes.detail.walkingReview=exportWalkingReview(scenes.detail);
const sourceFiles=[...new Set([...moduleUrls.keys()].map(file=>path.relative(base,file)).concat(['src/BuildingEntrance.tsx','src/Office.tsx']))].sort();
const originalGlbSha256=Object.fromEntries(fs.readdirSync(path.join(base,'public/models')).filter(file=>file.endsWith('.glb')).sort().map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(base,'public/models',file))).digest('hex')]));
const sceneGeometrySha256=Object.fromEntries(Object.entries(scenes).map(([key,scene])=>[key,crypto.createHash('sha256').update(JSON.stringify(scene)).digest('hex')]));
const snapshot={sceneGeometrySha256,originalGlbSha256,description:'Blender review of actual runtime layout/decor and original GLBs. Resident IDs/states are illustrative fixture data; this is not a live UI capture. Camera, studio lighting and text rendering are presentation-only. Walking samples call the shared lifecycle controller and routes at 60 Hz; review output retains real travel speed and full-size residents.',coordinateTransform:'glTF [x,y,z] -> Blender [x,-z,y]; yaw -> Blender Z',sourceSha256:Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(base,file))).digest('hex')])),meetingChairOffset,scenes};
const out=path.join(base,'assets-source/corporate-layout.json'),serialized=JSON.stringify(snapshot,null,2)+'\n';
if(process.argv.includes('--check')){
  if(fs.readFileSync(out,'utf8')!==serialized)throw new Error('Frozen walking snapshot no longer matches the shared runtime sources/controller.');
  console.log('Verified frozen snapshot against a fresh complete shared-controller simulation.');
}else{
  fs.writeFileSync(out,serialized);console.log(`Exported ${out}; ${scenes.overview.residents.length} overview residents, ${scenes.detail.solids.length} detail solids, chair offset ${meetingChairOffset}.`);
}
fs.rmSync(moduleDirectory,{recursive:true,force:true});

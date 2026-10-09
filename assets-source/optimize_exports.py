"""Batch meshes by parent + material while retaining articulation and original shapes."""
import bpy,os,math,json
from mathutils import Vector
BASE=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
scene=bpy.context.scene
roots={'desk':'DeskRoot','chair':'ChairRoot','agent':'AgentRoot','plant':'PlantRoot','bookshelf':'BookshelfRoot','sofa':'SofaRoot','floorlamp':'FloorLampRoot','coffeetable':'CoffeeTableRoot'}
JOINTS=['Body','Head']+[n+'.'+s for s in ['L','R'] for n in ['UpperArm','LowerArm','Hand','UpperLeg','LowerLeg','Foot']]
manifest=json.load(open(os.path.join(BASE,'public/models/asset-manifest.json')))
for key,rname in roots.items():
 r=bpy.data.objects[rname];loc=r.location.copy();rot=r.rotation_euler.copy();r.location=(0,0,0);r.rotation_euler=(0,0,0)
 pose={};tracks={}
 if key=='agent':
  for name in JOINTS:
   o=bpy.data.objects[name];pose[name]=(o.location.copy(),o.rotation_euler.copy())
   if o.animation_data:
    tracks[name]=[(t,t.mute) for t in o.animation_data.nla_tracks]
    for t in o.animation_data.nla_tracks:t.mute=True
   o.rotation_euler=(0,0,0)
  bpy.data.objects['Body'].location=(0,0,.84)
 if key=='chair':
  for o in r.children_recursive:
   if o.name.startswith('Chair.Caster') and not o.name.startswith('Chair.CasterStem'):o.location.z=.048
 groups={}
 for o in list(r.children_recursive):
  if o.type!='MESH':continue
  keyg=(o.parent,o.data.materials[0].name if o.data.materials else 'Default');groups.setdefault(keyg,[]).append(o)
 for (parent,ma),obs in groups.items():
  bpy.ops.object.select_all(action='DESELECT')
  for o in obs:o.select_set(True)
  bpy.context.view_layer.objects.active=obs[0]
  if len(obs)>1:bpy.ops.object.join()
  obs[0].name=parent.name+'.'+ma
 bpy.context.view_layer.update()
 coords=[o.matrix_world@Vector(c) for o in r.children_recursive if o.type=='MESH' for c in o.bound_box]
 lo=[min(v[i] for v in coords) for i in range(3)];hi=[max(v[i] for v in coords) for i in range(3)]
 manifest['assets'][key].update({'sizeXYZ':[round(hi[0]-lo[0],3),round(hi[2]-lo[2],3),round(hi[1]-lo[1],3)],'minXYZ':[round(lo[0],3),round(lo[2],3),round(-hi[1],3)],'maxXYZ':[round(hi[0],3),round(hi[2],3),round(-lo[1],3)],'meshes':sum(o.type=='MESH' for o in r.children_recursive)})
 bpy.ops.object.select_all(action='DESELECT')
 for o in [r]+list(r.children_recursive):o.select_set(True)
 bpy.context.view_layer.objects.active=r
 bpy.ops.export_scene.gltf(filepath=os.path.join(BASE,'public/models',key+'.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_animations=False,export_extras=True)
 r.location=loc;r.rotation_euler=rot
 for name,(l,ro) in pose.items():
  bpy.data.objects[name].location=l;bpy.data.objects[name].rotation_euler=ro
  for t,m in tracks.get(name,[]):t.mute=m
 print('BATCHED',key,manifest['assets'][key]['meshes'],flush=True)
manifest['animations']=['Idle','Walk','Work','Wave','WaveSeated','IdleSeated'];manifest['agent']['height']=manifest['assets']['agent']['sizeXYZ'][1]
manifest['agent']['deskChairOffsetZ']=.74
manifest['agent']['clipDurationsSeconds']={'Idle':2,'Walk':1,'Work':1,'Wave':2,'WaveSeated':2,'IdleSeated':2}
with open(os.path.join(BASE,'public/models/asset-manifest.json'),'w') as f:json.dump(manifest,f,indent=2)
# Correct staged reach; chair remains .05 m behind body for comfortable posture.
bpy.data.objects['AgentRoot'].location.y=-.10
scene.frame_set(9)
scene.cycles.use_denoising=False
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BASE,'assets-source','pi-office-studio.blend'),compress=True)
exec(compile(open(os.path.join(BASE,'assets-source','finalize_agent.py')).read(),os.path.join(BASE,'assets-source','finalize_agent.py'),'exec'),{'__file__':os.path.join(BASE,'assets-source','finalize_agent.py')})

"""Actual-layout Blender review with immutable original GLB meshes and rigs.

After runtime freeze:
  node assets-source/export_corporate_layout.mjs
  blender -b --factory-startup --python assets-source/render_corporate_workplace.py -- detail 64
Modes: detail, overview, closeup, walk, walk-sample. Optional third arg is resolution
scale. Walking mode consumes the frozen shared route/controller samples,
using actual GLB pose blending. No orbit or desk-scale/fade substitute is used.
Runtime geometry/transforms come from corporate-layout.json. Text, cameras,
lighting and the studio ground are review presentation only. Review sources
use new filenames; historical exports are never overwritten.
"""
import bpy, os, json, math, sys, subprocess
from mathutils import Vector
B=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE=os.path.join(B,'assets-source');REND=os.path.join(B,'asset-renders')
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
mode=args[0] if args else 'detail';samples=int(args[1]) if len(args)>1 else 64
scale=float(args[2]) if len(args)>2 else 1
if mode not in ('detail','overview','closeup','walk','walk-sample'):
 raise ValueError('Walking mode requires the frozen shared lifecycle export; no substitute animation is permitted.')
snapshot=json.load(open(os.path.join(SOURCE,'corporate-layout.json')))
bpy.context.preferences.filepaths.save_version=0
layout=snapshot['scenes']['overview' if mode=='overview' else 'detail']
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=samples;s.cycles.use_denoising=False
s.cycles.max_bounces=6;s.cycles.diffuse_bounces=3;s.cycles.glossy_bounces=3;s.cycles.transmission_bounces=4
s.render.image_settings.file_format='PNG';s.render.resolution_percentage=round(scale*100)
s.render.film_transparent=False;s.render.fps=24;s.view_settings.view_transform='AgX';s.view_settings.look='AgX - Medium High Contrast'
s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.45,.54,.63,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.42
material_cache={}
def lin(v):return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def mat(color,glass=False,emissive=False):
 key=(color,glass,emissive)
 if key in material_cache:return material_cache[key]
 rgb=tuple(lin(int(color.lstrip('#')[i:i+2],16)/255) for i in (0,2,4))
 m=bpy.data.materials.new('Corporate '+color+(' glass' if glass else ''));m.diffuse_color=(*rgb,.20 if glass else 1);m.use_nodes=True
 nodes=m.node_tree.nodes;p=nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*rgb,1);p.inputs['Roughness'].default_value=.12 if glass else .7;p.inputs['Metallic'].default_value=.12 if glass else .05
 if glass:
  transparent=nodes.new('ShaderNodeBsdfTransparent');mix=nodes.new('ShaderNodeMixShader');mix.inputs[0].default_value=.20;m.node_tree.links.new(transparent.outputs[0],mix.inputs[1]);m.node_tree.links.new(p.outputs[0],mix.inputs[2]);m.node_tree.links.new(mix.outputs[0],nodes.get('Material Output').inputs['Surface'])
 if emissive:p.inputs['Emission Color'].default_value=(*rgb,1);p.inputs['Emission Strength'].default_value=.5
 material_cache[key]=m;return m

def xyz(pos):return (pos[0],-pos[2],pos[1])
def box(name,pos,size,material):
 bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(pos));o=bpy.context.object;o.name=name;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material);return o
for spec in layout['solids']:box(spec['name'],spec['position'],spec['size'],mat(spec['color'],spec.get('glass',False),spec.get('emissive',False)))

# Independent articulated hierarchies share immutable mesh/material/action data.
# Never edit proportions, anatomy, exported material values, or source GLBs.
templates={}
def asset(spec):
 root=bpy.data.objects.new('ReviewInstance '+spec['name'],None);s.collection.objects.link(root)
 if spec['name'] not in templates:
  before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=os.path.join(B,'public/models',spec['name']+'.glb'));obs=set(bpy.data.objects)-before
  templates[spec['name']]=list(obs)
  for o in obs:
   if o.parent is None:o.parent=root
 else:
  original=templates[spec['name']];copies={o:o.copy() for o in original}
  for old,o in copies.items():
   s.collection.objects.link(o);o.parent=copies.get(old.parent,root)
   for modifier in o.modifiers:
    if modifier.type=='ARMATURE' and modifier.object in copies:modifier.object=copies[modifier.object]
  obs=set(copies.values())
 for o in obs:
  if o.animation_data:
   o.animation_data.action=None
   for tr in o.animation_data.nla_tracks:tr.mute=tr.name!=spec.get('clip')
 root.location=xyz(spec['position']);root.rotation_euler[2]=spec.get('rotation',0);root.scale=(spec.get('scale',1),)*3
 root['source_glb']=spec['name']+'.glb'
 if 'clip' in spec:root['source_animation']=spec['clip']
 return root
resident_instances={}
for spec in layout['assets']:asset(spec)
for spec in layout['residents']:resident_instances[(spec['roomIndex'],spec['deskIndex'])]=asset(spec)

fontpath='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font=bpy.data.fonts.load(fontpath) if os.path.exists(fontpath) else None
white=mat('#f0f5f6');ink=mat('#263b4b')
def label(body,pos,size,material=white):
 curve=bpy.data.curves.new('Review signage','FONT');curve.body=body;curve.align_x='CENTER';curve.align_y='CENTER';curve.size=size;curve.extrude=.0004;curve.space_character=1.08
 if font:curve.font=font
 o=bpy.data.objects.new('Review label '+body,curve);s.collection.objects.link(o);o.location=xyz(pos);o.rotation_euler=(math.pi/2,0,0);o.data.materials.append(material);return o
for spec in layout['labels']:
 if spec['kind'] in ('department','entrance'):label(spec['text'],spec['position'],spec['size'])
 else:
  p=spec['position'];width=max(1.65,len(spec['text'])*spec['size']*.64)
  box('Review-only facility sign',[p[0],p[1],p[2]-.018],[width,.30,.025],ink);label(spec['text'],[p[0],p[1],p[2]],spec['size'])
c=layout['facilities']['zones']['reception']['center'];label('PI  /  OFFICE',[c[0],.65,c[1]+.409],.20)

bounds=layout['bounds'];cx=(bounds['minX']+bounds['maxX'])/2;cz=(bounds['minZ']+bounds['maxZ'])/2
box('Review studio ground',[cx,-.395,cz],[200,.02,200],mat('#8399a8'))
def area(name,loc,power,size,target):
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);s.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
def camera(loc,target,ortho):
 d=bpy.data.cameras.new('CorporateReviewCamera');o=bpy.data.objects.new('CorporateReviewCamera',d);s.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();d.type='ORTHO';d.ortho_scale=ortho;d.lens=50;s.camera=o;return o
if mode=='overview':
 area('Large daylight key',(-14,-18,27),5500,15,(0,-cz,0));area('Soft blue fill',(16,7,20),3500,16,(0,-cz,0));area('Rear office fill',(-7,17,17),2100,12,(0,-cz,0))
 cam=camera((29,-39,35),(0,-cz,.35),50.5);s.render.resolution_x=2400;s.render.resolution_y=1800
else:
 area('Large daylight key',(-9,-12,17),2400,10,(0,-cz,0));area('Soft blue fill',(11,7,13),1500,10,(0,-cz,0));area('Office rim',(-5,9,12),1100,8,(0,-cz,0))
 cam=camera((14,-21,19),(0,-2.8,.5),24.5);s.render.resolution_x=2000;s.render.resolution_y=1700
 if mode=='closeup':cam.location=(9.5,-11,10);cam.rotation_euler=(Vector((.1,.55,.75))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=12.8;s.render.resolution_x=2000;s.render.resolution_y=1400
s.frame_set(30)
def fit_camera(camera,padding=1.09):
 bpy.context.view_layer.update();inv=camera.matrix_world.inverted();points=[]
 for obj in s.objects:
  if obj.type not in ('MESH','FONT') or obj.name=='Review studio ground':continue
  points.extend(inv @ (obj.matrix_world @ Vector(corner)) for corner in obj.bound_box)
 lo=[min(p[i] for p in points) for i in range(2)];hi=[max(p[i] for p in points) for i in range(2)]
 camera.location += camera.rotation_euler.to_matrix() @ Vector(((lo[0]+hi[0])/2,(lo[1]+hi[1])/2,0))
 aspect=s.render.resolution_x/s.render.resolution_y;camera.data.ortho_scale=max(hi[0]-lo[0],(hi[1]-lo[1])*aspect)*padding
 return camera.data.ortho_scale
if mode in ('walk','walk-sample'):
 s.render.resolution_x=960;s.render.resolution_y=720
 cam.location=(14,-24,19);cam.rotation_euler=(Vector((0,-3.8,.5))-cam.location).to_track_quat('-Z','Y').to_euler()
if mode in ('detail','overview','walk','walk-sample'):fit_camera(cam)
s['review_disclosure']=snapshot['description'];s['layout_snapshot']='corporate-layout.json';s['scene_geometry_sha256']=snapshot.get('sceneGeometrySha256',{}).get('overview' if mode=='overview' else 'detail','');s['source_sha256']=json.dumps(snapshot['sourceSha256']);s['coordinate_transform']=snapshot['coordinateTransform'];s['original_glb_sha256']=json.dumps(snapshot['originalGlbSha256'])
if mode not in ('walk','walk-sample'):
 s.render.filepath=os.path.join(REND,'blender-corporate-'+mode+'.png');bpy.ops.render.render(write_still=True)
 if mode=='detail':bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCE,'corporate-office-detail-review.blend'),compress=True)
else:
 review=layout['walkingReview'];hero=resident_instances[(review['roomIndex'],review['deskIndex'])]
 objects=list(hero.children_recursive);joints=[o for o in objects if o.animation_data and o.animation_data.nla_tracks]
 if not joints:raise RuntimeError('The original resident GLB has no authored animation tracks.')
 source_fps=s.render.fps
 # Freeze only the other fixture residents at their reviewed authored poses.
 # Their original NLA tracks are retained muted; no source GLB is modified.
 for root in resident_instances.values():
  if root==hero:continue
  animated=[o for o in root.children_recursive if o.animation_data and o.animation_data.nla_tracks]
  poses={o:o.matrix_basis.copy() for o in animated}
  for o in animated:
   for track in o.animation_data.nla_tracks:track.mute=True
   o.animation_data.action=None;o.matrix_basis=poses[o];o.rotation_mode='QUATERNION'
   for field in ('location','rotation_quaternion','scale'):o.keyframe_insert(data_path=field,frame=1)
 # Sample the original GLB clips, then slerp rotations / lerp translations.
 # This is a true weighted pose crossfade, never opacity or actor scaling.
 durations={}
 for o in joints:
  for track in o.animation_data.nla_tracks:
   if track.strips:durations[track.name]=max(durations.get(track.name,0),(track.strips[0].action_frame_end-track.strips[0].action_frame_start)/source_fps)
 pose_cache={}
 def sample_clip(clip,seconds):
  if clip not in durations:raise RuntimeError('Missing source GLB clip: '+clip)
  seconds=seconds%durations[clip] if durations[clip]>0 else 0
  key=(clip,round(seconds,7))
  if key not in pose_cache:
   for o in joints:
    o.animation_data.action=None
    for track in o.animation_data.nla_tracks:track.mute=track.name!=clip
   frame=1+seconds*source_fps;s.frame_set(int(math.floor(frame)),subframe=frame%1);bpy.context.view_layer.update()
   pose_cache[key]={o:o.matrix_basis.decompose() for o in joints}
  return pose_cache[key]
 baked=[]
 for sample in review['samples']:
  incoming=sample_clip(sample['clip'],sample['clipTime'])
  if sample['blendFrom'] and sample['blend']<1:
   outgoing=sample_clip(sample['blendFrom'],sample['blendFromTime']);weight=sample['blend']
   poses={o:(outgoing[o][0].lerp(incoming[o][0],weight),outgoing[o][1].slerp(incoming[o][1],weight),outgoing[o][2].lerp(incoming[o][2],weight)) for o in joints}
  else:poses=incoming
  baked.append(poses)
 for o in joints:
  o.animation_data.action=None
  for track in o.animation_data.nla_tracks:track.mute=True
  o.rotation_mode='QUATERNION'
 s.render.fps=review['fps'];s.frame_start=1;s.frame_end=len(review['samples']);hero.rotation_mode='XYZ';hero.scale=(1,1,1)
 for sample,poses in zip(review['samples'],baked):
  frame=sample['frame'];hero.location=xyz(sample['position']);hero.rotation_euler=(0,0,sample['yaw'])
  hero.keyframe_insert(data_path='location',frame=frame);hero.keyframe_insert(data_path='rotation_euler',frame=frame)
  for o in objects:
   if o.type=='MESH':o.hide_render=not sample['visible'];o.keyframe_insert(data_path='hide_render',frame=frame)
  for o,(location,rotation,object_scale) in poses.items():
   o.location=location;o.rotation_quaternion=rotation;o.scale=object_scale
   for field in ('location','rotation_quaternion','scale'):o.keyframe_insert(data_path=field,frame=frame)
 for o in [hero]+objects:
  if o.animation_data and o.animation_data.action:
   for fcurve in o.animation_data.action.fcurves:
    for point in fcurve.keyframe_points:point.interpolation='LINEAR'
 s['walking_review']=json.dumps({key:review[key] for key in ('routeLength','speed','fps','simulationHz','poseSeconds','crossfadeSeconds','walkGaitRate','turnSpeedRadiansPerSecond','duration','disclosure')})
 s['walking_review_events']=json.dumps(review['events']);s.frame_set(16)
 if mode=='walk-sample':
  s.render.filepath='/tmp/pi-office-walk-framing.png';bpy.ops.render.render(write_still=True)
 else:
  bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCE,'corporate-office-walking-review.blend'),compress=True)
  frames='/tmp/pi-office-natural-walking-frames';os.makedirs(frames,exist_ok=True);s.render.filepath=os.path.join(frames,'frame-');bpy.ops.render.render(animation=True)
  video=os.path.join(REND,'blender-corporate-natural-walking-lifecycle.mp4')
  caption='BLENDER VISUALIZATION | BRISK WALK-IN / WALK-OUT'
  speed_caption=f"{review['speed']:g} units per second | shared runtime route + heading | original GLB clips"
  filters="hqdn3d=1.0:1.0:2.0:2.0,drawbox=x=0:y=0:w=iw:h=39:color=0x172b38@0.88:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='"+caption+"':x=18:y=12:fontsize=16:fontcolor=white,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='"+speed_caption+"':x=18:y=h-25:fontsize=13:fontcolor=white:box=1:boxcolor=0x172b38@0.8:boxborderw=6"
  subprocess.run(['ffmpeg','-y','-framerate',str(review['fps']),'-i',os.path.join(frames,'frame-%04d.png'),'-frames:v',str(len(review['samples'])),'-vf',filters,'-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart','-metadata','title=Brisk natural-walking Blender entrance-to-desk and desk-to-exit review','-metadata','comment='+review['disclosure']+' Presentation postprocess: gentle spatial/temporal render grain reduction (hqdn3d=1:1:2:2).',video],check=True)


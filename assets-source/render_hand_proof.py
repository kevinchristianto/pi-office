"""Render anatomy proof from the actual exported GLB in rest, typing and wave.
Blender 4.3+: blender -b --factory-startup --python assets-source/render_hand_proof.py
No proxy hand geometry. Panel assembly: python assets-source/assemble_hand_proof.py
"""
import bpy,os
from mathutils import Vector
B=os.path.dirname(os.path.dirname(os.path.abspath(__file__)));R=os.path.join(B,'asset-renders');S=os.path.join(B,'assets-source')
s=bpy.context.scene

def mat(name,c):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*c,1);m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.9;return m

def setup():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=64;s.cycles.use_denoising=False;s.render.image_settings.file_format='PNG';s.render.resolution_percentage=100;s.render.resolution_x=900;s.render.resolution_y=720;s.view_settings.view_transform='AgX';s.world.color=(.15,.17,.19)
 bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.02));bpy.context.object.data.materials.append(mat('Proof floor',(.22,.25,.235)))
 for name,loc,power,size in [('Key',(-2,3,4),450,4),('Fill',(3,1,3),250,3),('Rim',(0,-2,4),400,3)]:
  d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);s.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()

def asset(name,pos=(0,0,0),clip=None):
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=os.path.join(B,'public/models',name+'.glb'));obs=set(bpy.data.objects)-before
 for o in obs:
  if o.parent is None:o.location=pos
  if o.animation_data:
   o.animation_data.action=None
   for t in o.animation_data.nla_tracks:t.mute=t.name!=clip
 return obs

def camera(loc,target,lens):
 d=bpy.data.cameras.new('ProofCamera');o=bpy.data.objects.new('ProofCamera',d);s.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();d.lens=lens;s.camera=o

def render(name):
 s.render.filepath=os.path.join(R,'hand-proof-'+name+'.png');bpy.ops.render.render(write_still=True)

setup();asset('agent-01',clip='Idle');s.frame_set(1);camera((0,1.8,.92),(0,0,.72),92);render('rest')
setup();asset('desk',(0,.74,.04));asset('chair',(0,0,.04));asset('agent-01',(0,0,.05),clip='Work');s.frame_set(4);camera((0,.28,1.77),(0,.49,.88),48);render('typing')
setup();obs=asset('agent-01',clip='Wave');s.frame_set(25);bpy.context.view_layer.update()
hand=next(o for o in obs if o.name=='Hand.R');coords=[o.matrix_world@Vector(c) for o in hand.children_recursive if o.type=='MESH' for c in o.bound_box];target=(Vector(tuple(min(v[i] for v in coords) for i in range(3)))+Vector(tuple(max(v[i] for v in coords) for i in range(3))))*.5
camera(target+Vector((.12,1.0,.12)),target,100);render('wave')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(S,'resident-hand-proof.blend'),compress=True)

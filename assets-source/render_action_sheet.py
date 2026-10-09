import bpy,os,math
from mathutils import Vector
B=os.path.dirname(os.path.dirname(os.path.abspath(__file__)));bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=64;s.cycles.use_denoising=False;s.render.resolution_x=1400;s.render.resolution_y=630;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.fps=24;s.world.color=(.24,.24,.24);s.view_settings.view_transform='AgX'
def material(name,color,rough=1):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*color,1);m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=rough;return m
floor=material('Sheet.WarmBackground',(.66,.68,.61));ink=material('Sheet.Ink',(.055,.13,.12))
for i,clip in enumerate(['Idle','Walk','Work','WaveSeated']):
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=os.path.join(B,'public/models/agent.glb'));obs=set(bpy.data.objects)-before;root=[o for o in obs if o.parent is None][0];root.location=(i*1.7-2.55,0,0);root.rotation_mode='XYZ';root.rotation_euler[2]=math.pi
 for o in obs:
  if o.animation_data:
   o.animation_data.action=None
   for t in o.animation_data.nla_tracks:t.mute=t.name!=clip
 if clip in ['Work','WaveSeated']:
  before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=os.path.join(B,'public/models/chair.glb'));obs=set(bpy.data.objects)-before;cr=[o for o in obs if o.parent is None][0];cr.location=(i*1.7-2.55,.02,0);cr.rotation_mode='XYZ';cr.rotation_euler[2]=math.pi
 bpy.ops.object.text_add(location=(i*1.7-2.55,-.02,2.08),rotation=(math.pi/2,0,0));o=bpy.context.object;o.data.body=clip;o.data.align_x='CENTER';o.data.size=.17;o.data.extrude=.001;o.data.materials.append(ink)
s.frame_set(17)
bpy.ops.mesh.primitive_plane_add(size=200);bpy.context.object.data.materials.append(floor)
def area(name,loc,energy,size):
 d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);s.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,.8))-o.location).to_track_quat('-Z','Y').to_euler()
area('Sheet.Key',(-3,-5,7),850,5);area('Sheet.Fill',(4,1,5),550,4)
d=bpy.data.cameras.new('ActionCamera');o=bpy.data.objects.new('ActionCamera',d);s.collection.objects.link(o);o.location=(3,-9,4.0);o.rotation_euler=(Vector((0,0,1.05))-o.location).to_track_quat('-Z','Y').to_euler();d.type='ORTHO';d.ortho_scale=7.5;s.camera=o
s.render.filepath=os.path.join(B,'asset-renders','blender-animation-contact-sheet.png');bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(B,'assets-source','agent-animation-review.blend'),compress=True)

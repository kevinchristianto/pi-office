"""Render the actual runtime cubicle dimensions and routes (Blender, not browser)."""
import bpy,os,json,math
from mathutils import Vector
B=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
layout=json.load(open(os.path.join(B,'assets-source/cubicle-layout.json')))
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=32;s.cycles.use_denoising=False;s.render.resolution_x=1400;s.render.resolution_y=950;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.world.color=(.23,.27,.22);s.view_settings.view_transform='AgX'
def material(name,color,rough=.8):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*color,1);m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=rough;return m
wood=material('Layout.Oak',(.43,.32,.21));sage=material('Layout.SageFabric',(.24,.38,.29),.95);cream=material('Layout.Plaster',(.72,.70,.59));trim=material('Layout.PanelTrim',(.49,.42,.29));grass=material('Layout.Surround',(.37,.45,.30));rug=material('Layout.Rug',(.46,.53,.38));frame=material('Layout.WindowFrame',(.72,.69,.56));glass=material('Layout.WindowView',(.49,.65,.62),.3)
def cube(name,pos,size,mat,bevel=0):
 x,y,z=pos;bpy.ops.mesh.primitive_cube_add(size=1,location=(x,-z,y));o=bpy.context.object;o.name=name;o.dimensions=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
 if bevel:mod=o.modifiers.new('soft edges','BEVEL');mod.width=bevel;mod.segments=2;o.modifiers.new('weighted normals','WEIGHTED_NORMAL')
 return o
cube('Office platform',(0,-.18,0),(12.4,.36,10.4),trim,.06);cube('Oak floor',(0,0,0),(12.05,.055,10.05),wood)
for i in range(30):cube('Plank seam',(-5.82+i*.4,.031,0),(.009,.004,10),trim)
cube('Continuous shared facade',(0,1.55,-5),(12.2,3.1,.18),cream)
for x in[-3.8,0,3.8]:
 cube('Window glass',(x,1.8,-4.88),(2.75,1.65,.06),glass)
 cube('Window sill',(x,.94,-4.75),(2.9,.09,.35),frame)
 for dx in[-.88,0,.88]:cube('Window mullion',(x+dx,1.8,-4.82),(.055,1.67,.08),frame)
 cube('Window crossbar',(x,1.8,-4.81),(2.76,.05,.08),frame)
cube('Soft workzone rug',(-1,.045,-.45),(9.9,.016,6.9),rug)
for p in layout['partitions']:
 x,z=p['center'];cube('Low acoustic '+p['kind'],(x,p['height']/2+.045,z),(p['width'],p['height'],p['depth']),sage,.015);cube('Oak cap',(x,p['height']+.065,z),(p['width']+.025,.045,p['depth']+.025),trim,.009)
def asset(name,pos,rotation=0,scale=1,clip=None):
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=os.path.join(B,'public/models',name+'.glb'));obs=set(bpy.data.objects)-before
 for o in obs:
  if o.parent is None:o.location=(pos[0],-pos[2],pos[1]);o.rotation_mode='XYZ';o.rotation_euler[2]=rotation;o.scale=(scale,scale,scale)
  if o.animation_data:
   o.animation_data.action=None
   for t in o.animation_data.nla_tracks:t.mute=t.name!=clip
for i,d in enumerate(layout['desks']):
 x,z=d['desk'];sx,sz=d['seat'];asset('desk',(x,.04,z));asset('chair',(sx,.04,sz));asset('agent',(sx,.04,sz),clip=['Work','ThinkSeated','WaitSeated','IdleSeated','ErrorSeated','DoneSeated'][i])
asset('plant',(-5.35,.05,-4.25),scale=1.05);asset('plant',(5.35,.05,-4.25));asset('bookshelf',(-5.55,.05,.9),math.pi/2);asset('floorlamp',(-5.25,.05,3.4));asset('sofa',(-2.8,.05,4.65),math.pi);asset('plant',(4.8,.05,4.65),scale=.7)
s.frame_set(30)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.39));bpy.context.object.data.materials.append(grass)
for name,loc,power,size in [('Key',(-7,-9,13),2100,8),('Fill',(8,5,11),1700,10)]:
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);s.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
d=bpy.data.cameras.new('CubicleCamera');o=bpy.data.objects.new('CubicleCamera',d);s.collection.objects.link(o);o.location=(12,-16,13);o.rotation_euler=(Vector((0,0,.5))-o.location).to_track_quat('-Z','Y').to_euler();d.type='PERSP';d.lens=45;s.camera=o
s.render.filepath=os.path.join(B,'asset-renders/blender-cubicle-layout.png');bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(B,'assets-source/pi-office-cubicles.blend'),compress=True)

"""Render actual exported resident GLBs, not browser screenshots. All lighting editable."""
import bpy,os,json,math,sys
from mathutils import Vector
B=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REND=os.path.join(B,'asset-renders');SOURCE=os.path.join(B,'assets-source')
mode=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else 'lineup'
samples=int(sys.argv[sys.argv.index('--')+2]) if '--' in sys.argv and len(sys.argv)>sys.argv.index('--')+2 else 32
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.device='CPU';s.cycles.samples=samples;s.cycles.use_denoising=False;s.render.image_settings.file_format='PNG';s.render.resolution_percentage=100;s.view_settings.view_transform='AgX';s.world.color=(.20,.23,.27)
def mat(name,color,rough=.85):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;return m
floor=mat('Review.Stone',(.20,.235,.225));back=mat('Review.WarmPlaster',(.59,.57,.49));letters=mat('Review.Ink',(.72,.77,.68))
def cube(name,loc,dim,ma,bev=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=dim;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(ma)
 if bev:m=o.modifiers.new('soft corners','BEVEL');m.width=bev;m.segments=3;o.modifiers.new('normals','WEIGHTED_NORMAL')
 return o
def asset(key,pos=(0,0,0),clip=None,yaw=0):
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=os.path.join(B,'public/models',key+'.glb'));obs=set(bpy.data.objects)-before
 for o in obs:
  if o.parent is None:o.location=pos;o.rotation_mode='XYZ';o.rotation_euler[2]=yaw
  if o.animation_data:
   o.animation_data.action=None
   for tr in o.animation_data.nla_tracks:tr.mute=tr.name!=clip
 return obs

def light(name,loc,power,size,target=(0,0,1)):
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);s.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler()
def camera(loc,target,lens=60,ortho=None):
 d=bpy.data.cameras.new('ReviewCamera');o=bpy.data.objects.new('ReviewCamera',d);s.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();d.lens=lens
 if ortho:d.type='ORTHO';d.ortho_scale=ortho
 s.camera=o;return o
def render(name,w,h):
 s.render.resolution_x=w;s.render.resolution_y=h;s.render.filepath=os.path.join(REND,name);bpy.ops.render.render(write_still=True)

def stage():
 cube('ReviewFloor',(0,0,-.035),(30,30,.06),floor);cube('ReviewBackdrop',(0,-1.2,2),(30,.05,5),back)
 light('Softbox',(-3,4,5),700,5);light('PortraitFill',(4,2,3),350,4);light('HairRim',(0,-1,4),600,3)

if mode=='preview':
 stage();asset('agent-02');camera((.47,2.0,1.68),(0,0,1.445),70);render('resident-preview.png',720,900)
elif mode=='lineup':
 stage()
 for i in range(8):
  x=(i-3.5)*.85;asset('agent-%02d'%(i+1),(x,0,0),clip='Idle',yaw=-.025 if i%2 else .025)
  c=bpy.data.curves.new('Variant %02d'%(i+1),'FONT');c.body='%02d'%(i+1);c.align_x='CENTER';c.size=.083;o=bpy.data.objects.new('Variant label',c);s.collection.objects.link(o);o.data.materials.append(letters);o.location=(x,.18,.007);o.rotation_euler=(0,0,0)
 s.frame_set(1);camera((2.4,12,3.9),(0,0,.84),65,7.3);render('blender-resident-lineup.png',2400,1000);bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCE,'resident-lineup-review.blend'),compress=True)
elif mode=='portraits':
 stage();camera((.40,2.2,1.63),(0,0,1.44),76)
 for i in range(8):
  requested=sys.argv[sys.argv.index('--')+3].split(',') if '--' in sys.argv and len(sys.argv)>sys.argv.index('--')+3 else None
  if requested and '%02d'%(i+1) not in requested:continue
  obs=asset('agent-%02d'%(i+1));render('resident-portrait-%02d.png'%(i+1),600,720)
  for o in obs:bpy.data.objects.remove(o,do_unlink=True)
elif mode=='office':
 # Exact tested runtime desk/seat/partition data, front edge and .74 m contact contract.
 layout=json.load(open(os.path.join(SOURCE,'cubicle-layout.json')))
 wood=mat('Office.Oak',(.43,.32,.21));sage=mat('Office.AcousticFabric',(.24,.38,.29));cream=mat('Office.Plaster',(.72,.70,.59));trim=mat('Office.OakTrim',(.49,.42,.29));rug=mat('Office.Rug',(.46,.53,.38));frame=mat('Office.WindowFrame',(.72,.69,.56));glass=mat('Office.WindowView',(.49,.65,.62),.3)
 def box(name,pos,size,ma,bevel=0):return cube(name,(pos[0],-pos[2],pos[1]),(size[0],size[2],size[1]),ma,bevel)
 box('Office platform',(0,-.18,0),(12.4,.36,10.4),trim,.06);box('Oak floor',(0,0,0),(12.05,.055,10.05),wood)
 for i in range(30):box('Plank seam',(-5.82+i*.4,.031,0),(.009,.004,10),trim)
 box('Continuous shared facade',(0,1.55,-5),(12.2,3.1,.18),cream)
 for x in [-3.8,0,3.8]:
  box('Window glass',(x,1.8,-4.88),(2.75,1.65,.06),glass);box('Window sill',(x,.94,-4.75),(2.9,.09,.35),frame)
  for dx in [-.88,0,.88]:box('Window mullion',(x+dx,1.8,-4.82),(.055,1.67,.08),frame)
  box('Window crossbar',(x,1.8,-4.81),(2.76,.05,.08),frame)
 box('Soft workzone rug',(-1,.045,-.45),(9.9,.016,6.9),rug)
 for p in layout['partitions']:
  x,z=p['center'];box('Acoustic '+p['kind'],(x,p['height']/2+.045,z),(p['width'],p['height'],p['depth']),sage,.015);box('Oak cap',(x,p['height']+.065,z),(p['width']+.025,.045,p['depth']+.025),trim,.009)
 for i,d in enumerate(layout['desks']):
  x,z=d['desk'];sx,sz=d['seat'];asset('desk',(x,-z,.04));asset('chair',(sx,-sz,.04));asset('agent-%02d'%(i+1),(sx,-sz,.05),clip=['Work','ThinkSeated','WaitSeated','IdleSeated','ErrorSeated','DoneSeated'][i])
 asset('plant',(-5.35,4.25,.05));asset('plant',(5.35,4.25,.05));asset('bookshelf',(-5.55,-.9,.05),yaw=math.pi/2);asset('floorlamp',(-5.25,-3.4,.05));asset('sofa',(-2.8,-4.65,.05),yaw=math.pi)
 # Additional standing residents demonstrate 8 variants without changing desk positions.
 asset('agent-07',(.10,-3.8,.04),clip='Idle',yaw=.6);asset('agent-08',(1.05,-3.95,.04),clip='Idle',yaw=-.6)
 cube('Ground',(0,0,-.40),(200,200,.02),floor);light('LargeKey',(-7,-9,13),2100,8,(0,0,0));light('LargeFill',(8,5,11),1700,10,(0,0,0));s.frame_set(30)
 camera((12,-16,13),(0,0,.5),45);render('blender-office-residents.png',2200,1500);bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCE,'resident-office-review.blend'),compress=True)

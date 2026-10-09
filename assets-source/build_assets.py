"""Original Pi Office Studio asset library. Blender 4.3+, no downloads.
Run: HOME=/tmp/blenderhome blender -b --factory-startup --python assets-source/build_assets.py
GLB contract: metres, Y-up, agent/chair forward -Z. Desk front +Z.
"""
import bpy, math, random, json, os
from mathutils import Vector
from math import sin, cos, pi
random.seed(17)
BASE=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(BASE,'public','models'); REND=os.path.join(BASE,'asset-renders')
os.makedirs(OUT,exist_ok=True); os.makedirs(REND,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for d in list(bpy.data.materials): bpy.data.materials.remove(d)
scene=bpy.context.scene
scene.render.engine='CYCLES'; scene.cycles.device='CPU'; scene.cycles.samples=24
scene.cycles.use_denoising=False
scene.render.image_settings.file_format='PNG'; scene.render.resolution_percentage=100
scene.world.color=(.18,.20,.24)
scene.view_settings.view_transform='AgX'
M={}
def mat(name,color,rough=.5,metal=0,emission=None):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
 b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=rough;b.inputs['Metallic'].default_value=metal
 if emission: b.inputs['Emission Color'].default_value=(*color,1);b.inputs['Emission Strength'].default_value=emission
 M[name]=m;return m
for a in [('Oak',(0.42,.235,.115),.36,0),('OakEdge',(.265,.12,.055),.4,0),('OakLight',(.52,.31,.16),.4,0),('Graphite',(.035,.055,.065),.32,.45),('MetalWarm',(.70,.49,.20),.28,.78),('PlasticDark',(.033,.045,.048),.44,0),('KeyIvory',(.73,.76,.68),.4,0),('KeyAccent',(.84,.38,.16),.4,0),('Screen',(.02,.05,.078),.35,0),('ScreenLine',(.26,.68,.59),.5,0),('ScreenBlue',(.23,.49,.76),.5,0),('Paper',(.79,.74,.61),.75,0),('Ceramic',(.72,.29,.15),.25,0),('Coffee',(.05,.024,.011),.24,0),('ChairFabric',(.13,.28,.27),.88,0),('ChairFrame',(.085,.13,.135),.4,.35),('Agent_Shirt',(.17,.43,.39),.84,0),('Agent_ShirtRib',(.11,.31,.29),.8,0),('Agent_Skin',(.67,.37,.23),.68,0),('Agent_SkinLight',(.72,.43,.29),.68,0),('Agent_Hair',(.052,.024,.019),.68,0),('Agent_HairLight',(.088,.046,.029),.72,0),('Agent_Trousers',(.12,.16,.205),.83,0),('Agent_Shoes',(.74,.73,.65),.62,0),('Agent_Sole',(.87,.83,.7),.65,0),('EyeWhite',(.96,.95,.86),.28,0),('EyeIris',(.10,.28,.24),.27,0),('EyeBlack',(.008,.012,.015),.25,0),('Mouth',(.30,.10,.07),.6,0),('PlantLeaf',(.08,.29,.14),.65,0),('PlantLeafLight',(.19,.43,.17),.65,0),('PlantStem',(.15,.25,.10),.8,0),('PotClay',(.68,.32,.20),.77,0),('PotIvory',(.78,.73,.58),.7,0),('Soil',(.055,.034,.016),1,0),('SofaFabric',(.67,.36,.18),.94,0),('CushionCream',(.79,.70,.50),.95,0),('CushionSage',(.30,.42,.31),.95,0),('LampShade',(.92,.76,.50),.85,0),('BookSage',(.30,.44,.38),.8,0),('BookRust',(.60,.25,.14),.8,0),('BookNavy',(.13,.21,.29),.8,0),('BookGold',(.75,.54,.25),.8,0)]:mat(*a)
M['ScreenLine'].node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value=(.26,.68,.59,1);M['ScreenLine'].node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=.45
M['ScreenBlue'].node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value=(.23,.49,.76,1);M['ScreenBlue'].node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value=.3
mat('Bulb',(1,.70,.33),.5,0,3)
CUR=None
assets={}
def root(name):
 global CUR
 CUR=bpy.data.objects.new(name,None);scene.collection.objects.link(CUR);return CUR
def parent(o,p=None):
 if p is None:p=CUR
 if p is not None:o.parent=p
 return o
def apply(o,name,ma,bevel=0,smooth=True,p=None):
 o.name=name
 if ma:o.data.materials.append(M[ma])
 if bevel:
  mod=o.modifiers.new('Soft manufactured edges','BEVEL');mod.width=bevel;mod.segments=3
  bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 if smooth:
  for f in o.data.polygons:f.use_smooth=True
  mod=o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL');mod.keep_sharp=True
  try:bpy.ops.object.modifier_apply(modifier=mod.name)
  except:pass
 return parent(o,p)
def cube(name,loc,scale,ma,bevel=.015,p=None):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return apply(o,name,ma,bevel,p=p)
def sphere(name,loc,scale,ma,p=None,seg=24,rings=16):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,radius=1,location=loc);o=bpy.context.object;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);return apply(o,name,ma,p=p)
def cyl(name,loc,rad,depth,ma,p=None,verts=32,rad2=None):
 bpy.ops.mesh.primitive_cone_add(vertices=verts,radius1=rad,radius2=rad if rad2 is None else rad2,depth=depth,location=loc);return apply(bpy.context.object,name,ma,min(.007,rad*.15),p=p)
def torus(name,loc,major,minor,ma,p=None,rot=None):
 bpy.ops.mesh.primitive_torus_add(major_segments=40,minor_segments=10,location=loc,major_radius=major,minor_radius=minor);o=bpy.context.object
 if rot:o.rotation_euler=rot
 return apply(o,name,ma,p=p)
def rod(name,a,b,r,ma,p=None,r2=None):
 a,b=Vector(a),Vector(b);o=cyl(name,(a+b)/2,r,(b-a).length,ma,p=p,rad2=r2);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
def path(name,points,r,ma,p=None):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=8;c.bevel_depth=r;c.bevel_resolution=3;s=c.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
 for bp,co in zip(s.bezier_points,points):bp.co=co;bp.handle_left_type='AUTO';bp.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,c);scene.collection.objects.link(o);o.data.materials.append(M[ma]);parent(o,p);bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.convert(target='MESH');o.select_set(False);return o

def mesh(name,verts,faces,ma,p=None):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);scene.collection.objects.link(o);return apply(o,name,ma,p=p)
def empty(name,loc,p):
 o=bpy.data.objects.new(name,None);scene.collection.objects.link(o);o.parent=p;o.location=loc;return o

def children(r):return [r]+list(r.children_recursive)
def export_asset(key,r,animate=False):
 bpy.ops.object.select_all(action='DESELECT')
 for o in children(r):o.select_set(True)
 bpy.context.view_layer.objects.active=r
 bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,key+'.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_animations=animate,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_force_sampling=True,export_optimize_animation_size=False,export_extras=True)
 assets[key]=r
 print('EXPORTED',key,flush=True)

# 01 / floating oak-top workstation with quiet precision details.
r=root('DeskRoot')
cube('Desk.OakTop',(0,0,.757),(1.82,.9,.058),'Oak',.035)
cube('Desk.UnderEdge',(0,0,.724),(1.75,.85,.018),'OakEdge',.018)
for x in [-.79,.79]:
 cube('Desk.FrameLeg',(x,.03,.369),(.058,.095,.694),'Graphite',.018)
 cube('Desk.TFoot',(x,.005,.049),(.09,.71,.055),'Graphite',.022)
 for y in [-.32,.32]:cube('Desk.AdjustableFoot',(x,y,.018),(.064,.078,.028),'PlasticDark',.01)
cube('Desk.SupportRail',(0,.15,.662),(1.62,.05,.057),'Graphite',.013)
cube('Desk.CableTray',(0,.29,.652),(.99,.17,.08),'Graphite',.015)
path('Desk.PowerCable',[(.32,.28,.76),(.32,.30,.67),(.65,.30,.62),(.74,.08,.34),(.77,.19,.08)],.009,'PlasticDark')
# monitor with bezel, indicator and productive screen UI geometry.
cube('Monitor.Base',(0,.265,.805),(.40,.23,.027),'Graphite',.04)
cube('Monitor.Support',(0,.315,.975),(.06,.048,.34),'Graphite',.015)
cube('Monitor.Bezel',(0,.28,1.215),(.86,.058,.493),'PlasticDark',.027)
cube('Monitor.Screen',(0,.246,1.215),(.812,.008,.443),'Screen',.014)
cube('Monitor.BottomChin',(0,.237,.987),(.81,.012,.023),'Graphite',.004)
sphere('Monitor.StatusLED',(.371,.227,.987),(.004,.003,.004),'ScreenLine',seg=12,rings=8)
# restrained editor panels, code bars and chart.
cube('Screen.Sidebar',(-.318,.239,1.218),(.135,.002,.407),'Graphite',.005)
for i in range(8):
 cube('Screen.SidebarItem',(-.317,.235,1.371-i*.043),(.087 if i%3 else .11,.003,.008),'ScreenBlue' if i==1 else 'KeyIvory',.002)
for i in range(11):
 x=-.184+(i%3)*.016;ln=[.225,.172,.262,.144,.234][i%5]
 cube('Screen.CodeLine',(x+ln/2,.236,1.369-i*.025),(ln,.003,.007),'ScreenLine' if i%3 else 'ScreenBlue',.002)
for i,h in enumerate([.054,.089,.067,.105,.133,.112,.158]):cube('Screen.ActivityBar',(.14+i*.031,.236,1.035+h/2),(.019,.003,h),'ScreenLine',.003)
# low-profile keyboard, 68 individually authored keycaps.
cube('Keyboard.Case',(-.015,-.23,.809),(.61,.204,.035),'Graphite',.015)
for row in range(5):
 for col in range(14):
  if row==4 and 3<=col<=9:continue
  cube('Keyboard.Key.%02d.%02d'%(row,col),(-.291+col*.042,-.307+row*.039,.832),(.034,.029,.012),'KeyAccent' if (row==0 and col==0) or (row==3 and col==13) else 'KeyIvory',.004)
cube('Keyboard.Space',(-.036,-.151,.833),(.278,.029,.012),'KeyIvory',.004)
cube('Mouse.Mat',(.459,-.23,.792),(.27,.30,.005),'ChairFabric',.035)
sphere('Mouse.Body',(.449,-.226,.818),(.047,.073,.027),'KeyIvory')
cube('Mouse.Seam',(.449,-.251,.842),(.0015,.056,.002),'Graphite',.001)
cyl('Mouse.Wheel',(.449,-.237,.846),.008,.006,'Graphite').rotation_euler=(0,pi/2,0)
# laptop secondary display, hinge, palm rest and tiny keyboard.
cube('Laptop.Base',(-.655,.12,.808),(.365,.245,.022),'KeyIvory',.018)
cube('Laptop.Keyboard',(-.655,.135,.821),(.296,.11,.004),'Graphite',.009)
for row in range(3):
 for col in range(10):cube('Laptop.Key',(-.782+col*.028,.099+row*.032,.824),(.023,.024,.003),'KeyIvory',.003)
cube('Laptop.Trackpad',(-.655,.026,.823),(.105,.054,.003),'Paper',.006)
cube('Laptop.DisplayShell',(-.655,.252,.955),(.369,.021,.287),'KeyIvory',.014)
cube('Laptop.Display',(-.655,.239,.956),(.335,.004,.25),'Screen',.006)
for i in range(5):cube('Laptop.Schedule',(-.674,.235,1.041-i*.039),(.223-.021*(i%3),.002,.012),'ScreenBlue' if i%2 else 'ScreenLine',.002)
# ceramic cup and notebook.
cyl('Mug.Cup',(.67,.03,.85),.052,.129,'Ceramic',rad2=.059)
cyl('Mug.Coffee',(.67,.03,.912),.049,.002,'Coffee')
torus('Mug.Rim',(.67,.03,.916),.054,.006,'Ceramic')
torus('Mug.Handle',(.742,.03,.857),.033,.01,'Ceramic',rot=(pi/2,0,0))
cube('Notebook.Cover',(.723,-.225,.805),(.213,.274,.025),'BookSage',.013)
cube('Notebook.Pages',(.723,-.227,.811),(.198,.256,.019),'Paper',.005)
cube('Notebook.Top',(.723,-.225,.824),(.215,.277,.006),'BookSage',.009)
rod('Notebook.Pen',(.632,-.32,.833),(.738,-.141,.833),.005,'MetalWarm')
export_asset('desk',r)

# 02 / ergonomic task chair: 5-star castors, breathable slat back, soft pads.
r=root('ChairRoot')
cyl('Chair.Lift', (0,0,.288),.035,.31,'Graphite')
cyl('Chair.LiftCollar',(0,0,.18),.049,.10,'ChairFrame')
for i in range(5):
 a=2*pi*i/5+.3;end=(.32*cos(a),.32*sin(a),.097)
 rod('Chair.StarArm',(0,0,.123),end,.028,'ChairFrame',r2=.020)
 wheel=cyl('Chair.Caster',end,.045,.053,'PlasticDark');wheel.rotation_euler=(pi/2,0,a)
 rod('Chair.CasterStem',(end[0],end[1],.087),(end[0],end[1],.125),.012,'Graphite')
cube('Chair.SeatShell',(0,0,.438),(.56,.51,.056),'ChairFrame',.066)
cube('Chair.SeatPad',(0,.012,.478),(.54,.50,.076),'ChairFabric',.085)
# curved back y bows away from sitter.
for x in [-.227,.227]:path('Chair.BackUpright',[(x,-.18,.42),(x,-.25,.62),(x,-.30,.91),(x,-.26,1.10)],.019,'ChairFrame')
path('Chair.BackTop',[(-.22,-.26,1.10),(0,-.276,1.124),(.22,-.26,1.10)],.023,'ChairFrame')
path('Chair.BackBottom',[(-.22,-.245,.63),(0,-.263,.604),(.22,-.245,.63)],.024,'ChairFrame')
for i in range(13):
 x=-.199+i*.0332;path('Chair.BreathableSlat',[(x,-.267,.628),(x,-.279,.75),(x,-.31,.9),(x,-.273,1.085)],.009,'ChairFabric')
cube('Chair.LumbarPad',(0,-.241,.733),(.39,.036,.095),'ChairFabric',.038)
for x in [-.329,.329]:
 path('Chair.ArmSupport',[(x*.76,-.05,.433),(x,-.095,.56),(x,-.085,.678)],.016,'ChairFrame')
 cube('Chair.ArmPad',(x,-.032,.691),(.072,.294,.041),'ChairFabric',.029)
rod('Chair.HeightLever',(.19,-.05,.4),(.34,-.07,.396),.011,'Graphite')
sphere('Chair.LeverGrip',(.34,-.07,.396),(.043,.02,.017),'PlasticDark')
export_asset('chair',r)

# 03 / articulated expressive studio resident. All pivots are real GLTF nodes.
r=root('AgentRoot');r['forward']='-Z';r['units']='metres';r['authored_by']='Pi Office original procedural sculpt'
body=empty('Body',(0,0,.84),r)
# tailored torso ring mesh, shoulders and collar; local coords.
verts=[];faces=[];rings=[(0,.158,.105),(.055,.171,.112),(.21,.197,.12),(.39,.232,.124),(.455,.236,.113),(.495,.151,.094)]
N=32
for z,rx,ry in rings:
 for i in range(N):a=i*2*pi/N;verts.append((rx*cos(a),ry*sin(a),z))
for j in range(len(rings)-1):
 for i in range(N):faces.append((j*N+i,j*N+(i+1)%N,(j+1)*N+(i+1)%N,(j+1)*N+i))
faces.extend([tuple(range(N-1,-1,-1)),tuple((len(rings)-1)*N+i for i in range(N))])
mesh('Agent.Sweater',verts,faces,'Agent_Shirt',body)
cube('Agent.Hem',(0,0,.04),(.326,.218,.042),'Agent_ShirtRib',.032,p=body)
cyl('Agent.Neck',(0,0,.52),.069,.11,'Agent_Skin',p=body)
torus('Agent.Collar',(0,0,.499),.074,.016,'Agent_ShirtRib',p=body)
# modest stitched chest badge and zipper.
cube('Agent.ChestPatch',(.115,.119,.342),(.059,.011,.042),'CushionCream',.008,p=body)
cube('Agent.PatchLine',(.115,.127,.342),(.032,.002,.006),'Agent_ShirtRib',.001,p=body)
head=empty('Head',(0,0,.52),body)
sphere('Agent.Head',(0,0,.16),(.157,.137,.197),'Agent_Skin',head,32,24)
sphere('Agent.Jaw',(0,.024,.06),(.124,.116,.096),'Agent_Skin',head)
for s in [-1,1]:
 sphere('Agent.Ear',(.155*s,0,.15),(.034,.034,.048),'Agent_Skin',head)
 sphere('Agent.EarInner',(.169*s,.018,.15),(.015,.014,.027),'Agent_SkinLight',head)
 sphere('Agent.EyeWhite',(.058*s,.125,.201),(.037,.018,.027),'EyeWhite',head)
 sphere('Agent.Iris',(.058*s,.142,.200),(.014,.007,.016),'EyeIris',head,20,12)
 sphere('Agent.Pupil',(.058*s,.148,.201),(.0078,.004,.011),'EyeBlack',head,16,10)
 sphere('Agent.EyeCatchlight',(.054*s,.152,.208),(.0038,.002,.004),'EyeWhite',head,12,8)
 path('Agent.Eyebrow',[ (.022*s,.132,.249),(.056*s,.145,.259),(.091*s,.13,.25)],.008,'Agent_Hair',head)
 sphere('Agent.Cheek',(.094*s,.102,.114),(.034,.018,.024),'Agent_SkinLight',head)
sphere('Agent.Nose',(0,.139,.157),(.023,.032,.038),'Agent_SkinLight',head)
path('Agent.Smile',[(-.043,.123,.089),(-.023,.139,.081),(0,.144,.079),(.024,.139,.084),(.041,.124,.095)],.005,'Mouth',head)
# sculpted hair cap with dipped back edge and lifted front quiff.
verts=[(0,-.01,.368)];faces=[];steps=10;ns=48
for j in range(1,steps+1):
 for i in range(ns):
  a=i*2*pi/ns;front=max(0,sin(a));theta=(1.92-.66*front)*j/steps
  verts.append((.167*sin(theta)*cos(a),-.013+.146*sin(theta)*sin(a),.171+.205*cos(theta)))
for i in range(ns):faces.append((0,1+i,1+(i+1)%ns))
for j in range(steps-1):
 for i in range(ns):faces.append((1+j*ns+i,1+j*ns+(i+1)%ns,1+(j+1)*ns+(i+1)%ns,1+(j+1)*ns+i))
mesh('Agent.HairCap',verts,faces,'Agent_Hair',head)
for i in range(7):
 x=-.117+i*.035
 path('Agent.HairSweep',[(x,.102,.280),(x+.026,.115,.318),(x+.042,.062,.356),(x+.029,-.023,.368)],.014,'Agent_HairLight' if i%3==0 else 'Agent_Hair',head)
# articulated limbs: +X is character left.
joints={'Body':body,'Head':head}
for side,s in [('L',1),('R',-1)]:
 ua=empty('UpperArm.'+side,(s*.226,0,.428),body);joints[ua.name]=ua
 sphere('Agent.Shoulder.'+side,(s*.009,0,-.037),(.089,.106,.109),'Agent_Shirt',ua)
 rod('Agent.Sleeve.'+side,(0,0,-.035),(s*.02,0,-.272),.074,'Agent_Shirt',ua,r2=.057)
 la=empty('LowerArm.'+side,(s*.02,0,-.285),ua);joints[la.name]=la
 sphere('Agent.Elbow.'+side,(0,0,-.004),(.057,.058,.06),'Agent_Shirt',la)
 rod('Agent.ForeSleeve.'+side,(0,0,0),(0,0,-.217),.056,'Agent_Shirt',la,r2=.041)
 cyl('Agent.Cuff.'+side,(0,0,-.217),.046,.043,'Agent_ShirtRib',la)
 hand=empty('Hand.'+side,(0,0,-.243),la);joints[hand.name]=hand
 sphere('Agent.Palm.'+side,(0,0,-.041),(.041,.025,.051),'Agent_Skin',hand)
 for k in range(4):
  x=-.027+k*.018;ln=[.035,.049,.046,.034][k]
  rod('Agent.Finger.'+side+'.'+str(k),(x,.002,-.063),(x,.008,-.063-ln),.009,'Agent_SkinLight',hand,r2=.007)
  sphere('Agent.Fingertip.'+side+'.'+str(k),(x,.008,-.063-ln),(.007,.008,.009),'Agent_SkinLight',hand,12,8)
 rod('Agent.Thumb.'+side,(s*.031,.003,-.027),(s*.053,.026,-.062),.013,'Agent_Skin',hand,r2=.010)
 if side=='L':
  cyl('Agent.WatchBand',(0,0,-.229),.047,.02,'Graphite',la)
  cube('Agent.WatchFace',(0,.047,-.229),(.036,.012,.029),'MetalWarm',.007,la)
 thigh=empty('UpperLeg.'+side,(s*.10,0,.007),body);joints[thigh.name]=thigh
 rod('Agent.TrouserUpper.'+side,(0,0,-.012),(0,.003,-.357),.088,'Agent_Trousers',thigh,r2=.063)
 knee=empty('LowerLeg.'+side,(0,0,-.376),thigh);joints[knee.name]=knee
 sphere('Agent.Knee.'+side,(0,0,-.006),(.063,.065,.07),'Agent_Trousers',knee)
 rod('Agent.TrouserLower.'+side,(0,0,-.014),(0,0,-.337),.061,'Agent_Trousers',knee,r2=.049)
 cube('Agent.TrouserCuff.'+side,(0,0,-.335),(.102,.109,.045),'Agent_Trousers',.016,knee)
 foot=empty('Foot.'+side,(0,0,-.358),knee);joints[foot.name]=foot
 cube('Agent.ShoeSole.'+side,(0,.040,-.088),(.135,.254,.035),'Agent_Sole',.029,foot)
 sphere('Agent.ShoeUpper.'+side,(0,.052,-.048),(.069,.129,.052),'Agent_Shoes',foot)
 cube('Agent.ShoeHeel.'+side,(0,-.046,-.031),(.113,.074,.052),'Agent_Shoes',.023,foot)
 for q in range(3):rod('Agent.ShoeLace.'+side,(-.041,.041+q*.019,-.009),(.041,.041+q*.019,-.009),.003,'Agent_Sole',foot)
 cube('Agent.ShoeStripe.'+side,(s*.063,.04,-.047),(.006,.106,.017),'Ceramic',.003,foot)
# actions gathered into NLA tracks so each animation is one GLTF clip.
scene.render.fps=24;scene.frame_start=1;scene.frame_end=49
rest={n:(o.location.copy(),o.rotation_euler.copy()) for n,o in joints.items()}
def addclip(clip,n,frames,values,prop='rotation_euler'):
 o=joints[n];o.animation_data_create();act=bpy.data.actions.new(clip+'_'+n);o.animation_data.action=act
 for fr,v in zip(frames,values):setattr(o,prop,v);o.keyframe_insert(data_path=prop,frame=fr)
 for fc in act.fcurves:
  for kp in fc.keyframe_points:kp.interpolation='BEZIER' if clip=='Idle' else 'LINEAR'
 o.animation_data.action=None;track=o.animation_data.nla_tracks.new();track.name=clip;st=track.strips.new(clip,1,act);st.action_frame_start=1;st.action_frame_end=max(frames);track.mute=True
 o.location=rest[n][0];o.rotation_euler=rest[n][1]
addclip('Idle','Body',[1,25,49],[(0,0,.84),(0,0,.848),(0,0,.84)],'location')
addclip('Idle','Head',[1,25,49],[(.008,0,-.025),(-.008,0,.025),(.008,0,-.025)])
for s in ['L','R']:addclip('Idle','UpperArm.'+s,[1,25,49],[(.012,0,0),(-.018,0,0),(.012,0,0)])
frames=[1,7,13,19,25]
addclip('Walk','Body',frames,[(0,0,.84),(0,0,.87),(0,0,.84),(0,0,.87),(0,0,.84)],'location')
for side,sg in [('L',1),('R',-1)]:
 addclip('Walk','UpperLeg.'+side,frames,[(sg*.54,0,0),(0,0,0),(-sg*.54,0,0),(0,0,0),(sg*.54,0,0)])
 vals=[-.10,-.67,-.10,-.20,-.10] if side=='L' else [-.10,-.20,-.10,-.67,-.10]
 addclip('Walk','LowerLeg.'+side,frames,[(v,0,0) for v in vals])
 addclip('Walk','UpperArm.'+side,frames,[(-sg*.48,0,0),(0,0,0),(sg*.48,0,0),(0,0,0),(-sg*.48,0,0)])
 addclip('Walk','LowerArm.'+side,[1,25],[(.20,0,0),(.20,0,0)])
addclip('Wave','UpperArm.R',[1,10,18,26,34,42,49],[(0,0,0),(.12,2.44,0),(.12,2.44,0),(.12,2.44,0),(.12,2.44,0),(.12,2.44,0),(0,0,0)])
addclip('Wave','LowerArm.R',[1,10,18,26,34,42,49],[(0,0,0),(.15,.18,0),(.15,-.16,0),(.15,.18,0),(.15,-.16,0),(.15,.18,0),(0,0,0)])
addclip('Wave','Head',[1,16,35,49],[(0,0,0),(0,.07,-.09),(0,.07,-.09),(0,0,0)])
addclip('Work','Body',[1,13,25],[(0,0,.55),(0,0,.553),(0,0,.55)],'location')
addclip('Work','Head',[1,13,25],[(.12,0,-.025),(.10,0,.025),(.12,0,-.025)])
for s in ['L','R']:
 addclip('Work','UpperLeg.'+s,[1,25],[(1.32,0,0),(1.32,0,0)])
 addclip('Work','LowerLeg.'+s,[1,25],[(-1.32,0,0),(-1.32,0,0)])
 addclip('Work','UpperArm.'+s,[1,25],[(.8,0,0),(.8,0,0)])
 sg=1 if s=='L' else -1
 addclip('Work','LowerArm.'+s,[1,7,13,19,25],[(1.0+sg*.03,0,0),(1.0-sg*.03,0,0),(1.0+sg*.03,0,0),(1.0-sg*.03,0,0),(1.0+sg*.03,0,0)])
 addclip('Work','Hand.'+s,[1,7,13,19,25],[(-.27,0,0),(-.19,0,0),(-.27,0,0),(-.19,0,0),(-.27,0,0)])
# unmute for export, exporter isolates each track.
for o in joints.values():
 if o.animation_data:
  for tr in o.animation_data.nla_tracks:tr.mute=False
export_asset('agent',r,True)
for o in joints.values():
 if o.animation_data:
  for tr in o.animation_data.nla_tracks:tr.mute=True
 o.location=rest[o.name][0];o.rotation_euler=rest[o.name][1]

# 04 / sculpted broad-leaf indoor ficus.
r=root('PlantRoot')
cyl('Plant.Planter',(0,0,.235),.20,.44,'PotIvory',rad2=.255)
torus('Plant.PlanterLip',(0,0,.462),.249,.012,'PotIvory')
cyl('Plant.Soil',(0,0,.451),.235,.01,'Soil')
for i in range(16):
 a=i*2.399;z=.56+(i%6)*.122;length=.26+random.random()*.17
 stem_end=(cos(a)*length*.65,sin(a)*length*.65,z+.13)
 path('Plant.Branch',[(0,0,.43),(.024*cos(a),.022*sin(a),z-.14),stem_end],.008,'PlantStem')
 # leaf is a curved pointed diamond with central ridge and eight tessellated pairs.
 direction=Vector((cos(a),sin(a),.21));side=Vector((-sin(a),cos(a),0));start=Vector(stem_end)-direction*.035
 vv=[]
 for j in range(9):
  t=j/8;mid=start+direction*(length*t)+Vector((0,0,.08*sin(pi*t)-.10*t*t));wid=.087*sin(pi*t)**.8
  vv.extend([tuple(mid-side*wid-Vector((0,0,.018*sin(pi*t)))),tuple(mid),tuple(mid+side*wid-Vector((0,0,.018*sin(pi*t))))])
 ff=[]
 for j in range(8):
  for k in range(2):ff.append((j*3+k,j*3+k+1,(j+1)*3+k+1,(j+1)*3+k))
 mesh('Plant.Leaf.%02d'%i,vv,ff,'PlantLeafLight' if i%3==0 else 'PlantLeaf')
 path('Plant.LeafVein',[vv[j*3+1] for j in [0,2,4,6,8]],.002,'PlantStem')
export_asset('plant',r)

# 05 / oak and smoked steel open bookcase, curated objects and books.
r=root('BookshelfRoot')
for x in [-.69,.69]:
 for y in [-.165,.165]:cube('Bookshelf.Upright',(x,y,.945),(.031,.031,1.89),'Graphite',.009)
for z in [.13,.58,1.03,1.48,1.90]:cube('Bookshelf.Shelf',(0,0,z),(1.48,.41,.045),'Oak',.018)
for level,z in enumerate([.154,.604,1.054,1.504]):
 for i in range([8,4,6,5][level]):
  width=.043+(i%3)*.012;height=.24+(i%4)*.035;x=-.60+i*.071
  cube('Bookshelf.BookCover',(x,0,z+height/2),(width,.24,height),['BookSage','BookRust','BookNavy','BookGold'][i%4],.006)
  cube('Bookshelf.BookPages',(x,-.006,z+height/2),(width*.70,.22,height-.014),'Paper',.002)
  cube('Bookshelf.BookSpine',(x,-.125,z+height/2),(width,.012,height),['BookSage','BookRust','BookNavy','BookGold'][i%4],.004)
  for dz in [-.067,.057]:cube('Bookshelf.SpineBand',(x,-.133,z+height/2+dz),(width*.71,.002,.006),'Paper',.001)
# stack of books, framed art, sculptural bowl, ceramic vases.
for i in range(3):cube('Bookshelf.StackedBook',(.39,0,.19+i*.048),(.34,.28,.041),['BookRust','BookSage','BookGold'][i],.007)
cube('Bookshelf.ArtFrame',(.36,.04,.816),(.35,.037,.38),'OakEdge',.012)
cube('Bookshelf.ArtPaper',(.36,.017,.817),(.305,.006,.336),'Paper',.003)
cyl('Bookshelf.ArtSun',(.36,.010,.845),.080,.004,'Ceramic').rotation_euler=(pi/2,0,0)
cube('Bookshelf.ArtHill',(.36,.005,.734),(.298,.008,.097),'BookSage',.003)
cyl('Bookshelf.Vase',(.39,0,1.17),.076,.215,'Ceramic',rad2=.049)
cyl('Bookshelf.VaseNeck',(.39,0,1.301),.049,.083,'Ceramic',rad2=.04)
rod('Bookshelf.DriedStem',(.39,0,1.31),(.43,.015,1.43),.004,'MetalWarm')
sphere('Bookshelf.Sculpture',(.39,0,1.639),(.118,.074,.096),'PotIvory')
torus('Bookshelf.SculptureRing',(.39,0,1.754),.067,.026,'PotIvory',rot=(pi/2,0,0))
export_asset('bookshelf',r)

# 06 / generous sofa, piping, stitched cushions and timber legs.
r=root('SofaRoot')
for x in [-.84,.84]:
 for y in [-.30,.30]:rod('Sofa.OakLeg',(x,y,.02),(x*.95,y*.9,.27),.04,'OakEdge',r2=.033)
cube('Sofa.LowerBody',(0,0,.305),(1.91,.84,.28),'SofaFabric',.10)
cube('Sofa.Back',(0,-.346,.641),(1.95,.19,.66),'SofaFabric',.09)
for x in [-.923,.923]:cube('Sofa.Arm',(x,0,.49),(.20,.88,.59),'SofaFabric',.08)
for x in [-.419,.419]:
 cube('Sofa.SeatCushion',(x,.04,.48),(.815,.655,.16),'SofaFabric',.061)
 cube('Sofa.BackCushion',(x,-.206,.748),(.811,.15,.436),'SofaFabric',.066)
 path('Sofa.SeatPiping',[(x-.36,-.23,.521),(x+.36,-.23,.521),(x+.371,.29,.521),(x-.371,.29,.521),(x-.36,-.23,.521)],.004,'CushionCream')
for x,ma in [(-.70,'CushionCream'),(.69,'CushionSage')]:
 o=cube('Sofa.ThrowPillow',(x,-.074,.743),(.32,.155,.31),ma,.066);o.rotation_euler=(.12,.13 if x>0 else -.15,0)
 sphere('Sofa.PillowButton',(x,.009,.743),(.011,.004,.011),ma)
export_asset('sofa',r)

# 07 / brass arc lamp and linen drum shade.
r=root('FloorLampRoot')
cyl('Lamp.Base',(0,0,.034),.23,.063,'Graphite')
cyl('Lamp.InsetBase',(0,0,.069),.165,.014,'MetalWarm')
path('Lamp.Arc',[(0,0,.064),(0,0,1.15),(.01,0,1.55),(.19,0,1.72),(.39,0,1.67)],.017,'MetalWarm')
cyl('Lamp.Shade',(.39,0,1.532),.23,.28,'LampShade',rad2=.205)
torus('Lamp.ShadeTop',(.39,0,1.672),.205,.009,'PotIvory')
torus('Lamp.ShadeBottom',(.39,0,1.392),.23,.009,'PotIvory')
cyl('Lamp.Diffuser',(.39,0,1.389),.218,.006,'Bulb')
# fine vertical linen ribs read in closeup, remain modest polygon count.
for i in range(40):
 a=i*2*pi/40;rod('Lamp.LinenRib',(.39+.228*cos(a),.228*sin(a),1.404),(.39+.205*cos(a),.205*sin(a),1.664),.0018,'CushionCream')
export_asset('floorlamp',r)

# 08 / personal meeting table accessory for natural movement destination.
r=root('CoffeeTableRoot')
cyl('CoffeeTable.Top',(0,0,.426),.49,.046,'Oak',verts=64)
for i in range(3):
 a=i*2*pi/3+.3;rod('CoffeeTable.Leg',(.34*cos(a),.34*sin(a),.018),(.22*cos(a),.22*sin(a),.404),.03,'OakEdge')
cube('CoffeeTable.Magazine',(0,0,.458),(.29,.215,.016),'BookSage',.009)
cube('CoffeeTable.MagazineLabel',(-.04,-.004,.468),(.14,.08,.002),'Paper',.004)
cyl('CoffeeTable.Bowl',(.24,.11,.495),.082,.09,'Ceramic',rad2=.107)
cyl('CoffeeTable.BowlInterior',(.24,.11,.54),.093,.003,'OakEdge')
export_asset('coffeetable',r)

# Reliable complete GLTF clips including fixed poses.
exec(compile(open(os.path.join(BASE,'assets-source','finalize_agent.py')).read(), os.path.join(BASE,'assets-source','finalize_agent.py'),'exec'), {'__file__': os.path.join(BASE,'assets-source','finalize_agent.py')})

# Save documented contracts before room staging.
manifest={'units':'metres','up':'+Y','agentForward':'-Z','chairForward':'-Z','deskFront':'+Z','animations':['Idle','Walk','Wave','Work','WaveSeated','IdleSeated'],'authorship':'Original procedural geometry authored for Pi Office. No external asset downloads.','assets':{},'agent':{'height':1.731,'root':'AgentRoot','pelvis':'Body','standingPelvisY':.84,'seatedPelvisY':.55,'leftIsPositiveX':True,'jointNames':list(joints),'rotationNote':'Use GLTF animation clips when possible. GLTF X drives flexion. Work is a complete seated typing pose. All meshes are individually parented to explicit joint nodes; no skinning. Material Agent_Shirt is the primary recolor surface.'}}
for key,r in assets.items():
 bpy.context.view_layer.update();coords=[o.matrix_world@Vector(c) for o in r.children_recursive if o.type=='MESH' for c in o.bound_box]
 lo=[min(v[i] for v in coords) for i in range(3)];hi=[max(v[i] for v in coords) for i in range(3)]
 manifest['assets'][key]={'file':key+'.glb','root':r.name,'sizeXYZ':[round(hi[0]-lo[0],3),round(hi[2]-lo[2],3),round(hi[1]-lo[1],3)],'minXYZ':[round(lo[0],3),round(lo[2],3),round(-hi[1],3)],'maxXYZ':[round(hi[0],3),round(hi[2],3),round(-lo[1],3)],'meshes':sum(o.type=='MESH' for o in r.children_recursive)}
with open(os.path.join(OUT,'asset-manifest.json'),'w') as f:json.dump(manifest,f,indent=2)

# Collection-aware duplicate helper for staged room (original roots stay as first instances).
def duplicate(r,name):
 mapping={}
 for ob in children(r):
  n=ob.copy()
  if ob.data:n.data=ob.data.copy()
  scene.collection.objects.link(n);mapping[ob]=n
 for ob,n in mapping.items():n.parent=mapping.get(ob.parent,None)
 mapping[r].name=name;return mapping[r]
# library origins placed in 7 x 6 m sample architecture.
assets['desk'].location=(-1.40,.64,0)
d2=duplicate(assets['desk'],'DeskRoot.Second');d2.location=(1.05,.64,0)
assets['chair'].location=(-1.40,-.15,0)
c2=duplicate(assets['chair'],'ChairRoot.Second');c2.location=(1.05,-.15,0)
assets['agent'].location=(-1.40,-.22,0)
# apply Work pose in source room. Exports were already captured in base pose.
for n,o in joints.items():
 if o.animation_data:
  for track in o.animation_data.nla_tracks:track.mute=track.name!='Work'
scene.frame_set(9)
a2=duplicate(assets['agent'],'AgentRoot.Greeter');a2.location=(.66,-1.85,0);a2.rotation_euler[2]=pi*.79
for o in a2.children_recursive:
 if o.animation_data:
  for tr in o.animation_data.nla_tracks:tr.mute=True
 if o.name.startswith('Body.'):o.location=(0,0,.84)
 if any(o.name.startswith(n+'.') for n in joints if n!='Body'):o.rotation_euler=(0,0,0)
assets['plant'].location=(2.80,1.75,0)
p2=duplicate(assets['plant'],'PlantRoot.Lounge');p2.location=(-2.82,-2.18,0);p2.scale=(.78,.78,.78)
assets['bookshelf'].location=(-2.02,2.28,0)
assets['sofa'].location=(-1.18,-2.37,0);assets['sofa'].rotation_euler[2]=pi
assets['floorlamp'].location=(-2.66,-2.36,0)
assets['coffeetable'].location=(-1.10,-1.21,0)
# architectural stage is only in editable blend, not imported as asset.
CUR=None
mat('RoomFloor',(.50,.36,.24),.76);mat('RoomWall',(.76,.75,.64),.95);mat('RoomTrim',(.42,.50,.40),.85);mat('Rug',(.60,.62,.50),1);mat('RugBorder',(.37,.44,.35),1)
cube('Room.Floor',(0,0,-.10),(7.0,6.2,.18),'RoomFloor',.045)
# thin floor plank seam geometry.
for i in range(19):cube('Room.PlankJoint',(-3.3+i*.37,0,-.006),(.009,6.1,.002),'OakEdge',.001)
for i in range(18):
 for j in range(4):cube('Room.StaggerJoint',(-3.116+i*.37,-2.6+j*1.68+(i%2)*.39,-.005),(.355,.008,.002),'OakEdge',.001)
cube('Room.BackWall',(0,3.055,1.41),(7,.12,2.82),'RoomWall',.035)
cube('Room.LeftWall',(-3.445,.05,1.41),(.12,6.0,2.82),'RoomWall',.035)
cube('Room.BaseboardBack',(0,2.98,.11),(6.9,.08,.21),'RoomTrim',.018)
cube('Room.BaseboardLeft',(-3.37,.02,.11),(.08,5.9,.21),'RoomTrim',.018)
# tall gallery window opening impression with glowing sky and mullions.
mat('WindowSky',(.48,.70,.78),.6,0,.6)
cube('Room.WindowReveal',(-3.36,.31,1.69),(.027,2.31,1.75),'RoomTrim',.035)
cube('Room.WindowSky',(-3.338,.31,1.69),(.01,2.13,1.56),'WindowSky',.016)
for y in [-.75,.31,1.37]:cube('Room.WindowMullion',(-3.32,y,1.69),(.045,.045,1.62),'PotIvory',.007)
cube('Room.WindowCrossbar',(-3.32,.31,1.66),(.047,2.17,.038),'PotIvory',.007)
cube('Room.WindowSill',(-3.23,.31,.88),(.29,2.44,.068),'Oak',.023)
# patterned low-pile lounge rug.
cube('Room.Rug',(-1.01,-1.91,.008),(2.76,2.0,.019),'Rug',.063)
for x in [-2.30,.28]:cube('Room.RugBorder',(x,-1.91,.02),(.018,1.84,.003),'RugBorder',.003)
for y in [-2.82,-1.0]:cube('Room.RugBorder',(-1.01,y,.02),(2.60,.018,.003),'RugBorder',.003)
for i in range(15):cube('Room.RugWeave',(-2.14+i*.163,-1.92,.021),(.006,1.72,.002),'CushionCream',.001)
# framed prints bring intentional studio color.
for x,color in [(1.01,'BookSage'),(2.13,'BookRust')]:
 cube('Room.ArtFrame',(x,2.951,1.73),(.79,.045,1.01),'OakEdge',.016)
 cube('Room.ArtMat',(x,2.922,1.73),(.714,.007,.93),'Paper',.002)
 cube('Room.ArtField',(x,2.914,1.70),(.51,.005,.65),color,.004)
 o=cyl('Room.ArtSun',(x-.04,2.907,1.91),.135,.003,'BookGold');o.rotation_euler=(pi/2,0,0)
 cube('Room.ArtHorizon',(x,2.9,1.55),(.505,.005,.11),'CushionCream',.001)
# lighting and cameras.
def area(name,loc,power,size,color,target):
 dat=bpy.data.lights.new(name,'AREA');dat.energy=power;dat.shape='DISK';dat.size=size;dat.color=color;o=bpy.data.objects.new(name,dat);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();return o
area('Softbox.Key',(1,-3,6),750,5.0,(1,.86,.69),(0,0,0))
area('Window.Fill',(-2.9,-.2,2.4),260,2.8,(.67,.83,1),(0,0,1))
area('Softbox.Rim',(1,2.3,4.7),420,3.0,(1,.78,.50),(0,0,1))
dat=bpy.data.lights.new('Lamp.WarmPool','POINT');dat.energy=12;dat.color=(1,.60,.29);dat.shadow_soft_size=.23;o=bpy.data.objects.new('Lamp.WarmPool',dat);scene.collection.objects.link(o);o.location=(-2.27,-2.36,1.38)
def camera(name,loc,target,ortho):
 dat=bpy.data.cameras.new(name);o=bpy.data.objects.new(name,dat);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector(target)-o.location).to_track_quat('-Z','Y').to_euler();dat.type='ORTHO';dat.ortho_scale=ortho;return o
cam=camera('Camera.RoomOverview',(8,-10,8),(0,0,.65),10.3)
close=camera('Camera.WorkstationDetail',(-.2,-2.8,2.2),(-1.32,.35,.98),2.76)
portrait=camera('Camera.CharacterDetail',(1.55,-3.3,1.9),(.66,-1.85,1.00),2.05)
scene.camera=cam;scene.render.resolution_x=1000;scene.render.resolution_y=800
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BASE,'assets-source','pi-office-studio.blend'),compress=True)
exec(compile(open(os.path.join(BASE,'assets-source','optimize_exports.py')).read(),os.path.join(BASE,'assets-source','optimize_exports.py'),'exec'),{'__file__':os.path.join(BASE,'assets-source','optimize_exports.py')})
scene.render.filepath=os.path.join(REND,'blender-room-overview.png');bpy.ops.render.render(write_still=True)
scene.camera=close;scene.render.resolution_x=900;scene.render.resolution_y=800;scene.render.filepath=os.path.join(REND,'blender-workstation-closeup.png');bpy.ops.render.render(write_still=True)
scene.camera=portrait;scene.render.resolution_x=700;scene.render.resolution_y=900;scene.render.filepath=os.path.join(REND,'blender-character-closeup.png');bpy.ops.render.render(write_still=True)
scene.camera=cam
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BASE,'assets-source','pi-office-studio.blend'),compress=True)
exec(compile(open(os.path.join(BASE,'assets-source','embed_state_clips.py')).read(),os.path.join(BASE,'assets-source','embed_state_clips.py'),'exec'),{'__file__':os.path.join(BASE,'assets-source','embed_state_clips.py')})
exec(compile(open(os.path.join(BASE,'assets-source','render_action_sheet.py')).read(),os.path.join(BASE,'assets-source','render_action_sheet.py'),'exec'),{'__file__':os.path.join(BASE,'assets-source','render_action_sheet.py')})
exec(compile(open(os.path.join(BASE,'assets-source','render_state_sheet.py')).read(),os.path.join(BASE,'assets-source','render_state_sheet.py'),'exec'),{'__file__':os.path.join(BASE,'assets-source','render_state_sheet.py')})
print('ALL_ASSETS_AND_RENDERS_COMPLETE',flush=True)

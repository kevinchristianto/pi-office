"""Pi Office adult resident collection, original authored geometry (CC0-1.0).
Blender 4.3+: blender -b --factory-startup --python assets-source/build_residents.py
No downloads, textures, add-ons, or external assets. Existing joint/clip contract retained.
"""
import bpy, os, math, json, struct, copy, random, ast, sys
from mathutils import Vector
from math import sin, cos, pi, exp
B=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(B,'public/models'); SOURCE=os.path.join(B,'assets-source'); REND=os.path.join(B,'asset-renders')
random.seed(104)
# Preserve the complete original motions, independent of exporter version/optimizations.
def read_glb(p):
 with open(p,'rb') as f:
  f.read(12);n,_=struct.unpack('<II',f.read(8));j=json.loads(f.read(n));n,_=struct.unpack('<II',f.read(8));blob=f.read(n)
 return j,blob
ORIGINAL,ORIGINAL_BIN=read_glb(os.path.join(OUT,'agent.glb'))
def inject_clips(p):
 j,blob=read_glb(p);blob=bytearray(blob);amap={};nodes={n.get('name'):i for i,n in enumerate(j['nodes'])}
 def accessor(ix):
  if ix in amap:return amap[ix]
  a=copy.deepcopy(ORIGINAL['accessors'][ix]);v=copy.deepcopy(ORIGINAL['bufferViews'][a['bufferView']]);start=v.get('byteOffset',0);data=ORIGINAL_BIN[start:start+v['byteLength']]
  while len(blob)%4:blob.append(0)
  v['byteOffset']=len(blob);v['buffer']=0;blob.extend(data);a['bufferView']=len(j['bufferViews']);j['bufferViews'].append(v);out=len(j['accessors']);j['accessors'].append(a);amap[ix]=out;return out
 j['animations']=copy.deepcopy(ORIGINAL['animations'])
 for clip in j['animations']:
  for samp in clip['samplers']:
   samp['input']=accessor(samp['input']);samp['output']=accessor(samp['output'])
  for ch in clip['channels']:ch['target']['node']=nodes[ORIGINAL['nodes'][ch['target']['node']]['name']]
 # Change exactly two rotation outputs; all other copied animation data stays exact.
 for clip in j['animations']:
  if clip['name'] not in ['Wave','WaveSeated']:continue
  for ch in clip['channels']:
   if j['nodes'][ch['target']['node']]['name']!='Hand.R' or ch['target']['path']!='rotation':continue
   samp=clip['samplers'][ch['sampler']];a=j['accessors'][samp['input']];v=j['bufferViews'][a['bufferView']];off=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',4)
   times=[struct.unpack_from('<f',blob,off+i*stride)[0] for i in range(a['count'])];values=[quat(pose(clip['name'],t)[0]['Hand.R']) for t in times]
   while len(blob)%4:blob.append(0)
   start=len(blob);raw=struct.pack('<'+'f'*(4*len(values)),*[n for value in values for n in value]);blob.extend(raw)
   bv=len(j['bufferViews']);j['bufferViews'].append({'buffer':0,'byteOffset':start,'byteLength':len(raw)})
   samp['output']=len(j['accessors']);j['accessors'].append({'bufferView':bv,'componentType':5126,'count':len(values),'type':'VEC4'})
 j['buffers'][0]['byteLength']=len(blob);js=json.dumps(j,separators=(',',':')).encode();js+=b' '*((-len(js))%4);blob+=b'\0'*((-len(blob))%4)
 with open(p,'wb') as f:
  f.write(struct.pack('<III',0x46546c67,2,12+8+len(js)+8+len(blob)));f.write(struct.pack('<II',len(js),0x4e4f534a));f.write(js);f.write(struct.pack('<II',len(blob),0x004e4942));f.write(blob)
 return j
# Use the source's existing authored pose functions without executing its file IO.
pose_src=ast.parse(open(os.path.join(SOURCE,'finalize_agent.py')).read())
keep=[]
for n in pose_src.body:
 if isinstance(n,ast.FunctionDef) and n.name in ['smooth','gesture','mix','pose','mul','quat']:keep.append(n)
 elif isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ['joints','CLIP_DURATIONS','STATE_CLIPS'] for t in n.targets):keep.append(n)
exec(compile(ast.Module(body=keep,type_ignores=[]),'<original-pose-contract>','exec'))
_original_pose=pose
def pose(clip,t):
 # Rest/typing meshes are pronated. During the user-facing wave, supinate only
 # the waving hand around its distal axis; calculate from authored base each
 # build, so rebuilding cannot accumulate another roll.
 rotations,body=_original_pose(clip,t)
 if clip in ['Wave','WaveSeated']:
  fade=max(0,min(1,t/.3,(2-t)/.3));rx,ry,_=rotations['Hand.R']
  rotations['Hand.R']=(rx,ry,pi*fade)
 return rotations,body
HAND_CONTRACT={'version':2,'coordinateSpace':'glTF joint-local, metres','rigLabelNote':'Legacy rig.L is +X and anatomically right; rig.R is -X and anatomically left, for forward -Z/up +Y. Names remain stable.','rest':'Palms rearward, dorsal surfaces forward, thumbs medial.','typing':'Palms down, dorsal surfaces up, thumbs toward keyboard midline.','wave':'Only rig.R Hand rotation rolls during Wave and WaveSeated to present the palm outward.','animationChanges':['Wave:Hand.R:rotation','WaveSeated:Hand.R:rotation'],'unchanged':'Every other animation input/output float payload is preserved.'}

VARIANTS=[
 dict(id='01',label='Cropped curls / oxford shirt',skin=(.33,.145,.077),hair=(.025,.013,.009),shirt=(.19,.34,.43),pants=(.07,.10,.13),shoe=(.11,.075,.05),style='curls',outfit='oxford',build=1.05,face=1.04,headheight=1.01,nose=1.15,lips=1.15,brows=1.1,beard=True),
 dict(id='02',label='Blunt bob / terracotta knit',skin=(.68,.38,.23),hair=(.022,.016,.013),shirt=(.49,.17,.105),pants=(.16,.16,.145),shoe=(.14,.105,.08),style='bob',outfit='knit',build=.89,face=.95,headheight=.98,nose=.84,lips=1.03,brows=.8),
 dict(id='03',label='Silver side part / charcoal cardigan',skin=(.68,.46,.32),hair=(.40,.42,.39),shirt=(.105,.145,.15),pants=(.17,.19,.19),shoe=(.085,.053,.033),style='part',outfit='cardigan',build=1.13,face=1.08,headheight=1.04,nose=1.13,lips=.87,brows=1.05,glasses=True,age=True),
 dict(id='04',label='Coiled natural hair / plum blouse',skin=(.19,.077,.037),hair=(.014,.009,.008),shirt=(.30,.105,.20),pants=(.10,.105,.13),shoe=(.13,.09,.065),style='coils',outfit='blouse',build=1.02,face=.98,headheight=1.0,nose=1.17,lips=1.24,brows=.9,earrings=True),
 dict(id='05',label='Dark swept hair / sage overshirt',skin=(.49,.295,.17),hair=(.018,.014,.012),shirt=(.23,.32,.23),pants=(.12,.15,.19),shoe=(.54,.52,.45),style='sweep',outfit='overshirt',build=.96,face=.99,headheight=1.025,nose=.93,lips=.94,brows=1.0),
 dict(id='06',label='Low auburn bun / navy blazer',skin=(.74,.49,.34),hair=(.18,.056,.025),shirt=(.075,.13,.22),pants=(.10,.12,.16),shoe=(.11,.06,.042),style='bun',outfit='blazer',build=.92,face=.92,headheight=.985,nose=.94,lips=1.0,brows=.85,earrings=True),
 dict(id='07',label='Close-shaved hair / ochre polo',skin=(.41,.22,.105),hair=(.045,.028,.017),shirt=(.48,.33,.11),pants=(.085,.10,.11),shoe=(.20,.16,.11),style='shaved',outfit='polo',build=1.17,face=1.07,headheight=1.02,nose=1.07,lips=1.07,brows=1.1,beard=True,glasses=True),
 dict(id='08',label='Salt-and-pepper waves / oatmeal knit',skin=(.61,.39,.255),hair=(.23,.22,.195),shirt=(.58,.50,.37),pants=(.18,.23,.24),shoe=(.26,.19,.135),style='waves',outfit='knit',build=1.06,face=1.03,headheight=1.005,nose=.96,lips=.93,brows=.85,age=True),
]
for v,offset in zip(VARIANTS,[.020,-.010,.040,.010,.025,-.010,.035,.005]):v['neckOffset']=offset
scene=bpy.context.scene
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for m in list(bpy.data.materials):bpy.data.materials.remove(m)
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=32;scene.cycles.use_denoising=False
scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.resolution_percentage=100;scene.world.color=(.20,.22,.25)
M={};CUR=None

def material(name,color,rough=.7,metal=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True;b=m.node_tree.nodes.get('Principled BSDF');b.inputs['Base Color'].default_value=(*color,1);b.inputs['Roughness'].default_value=rough;b.inputs['Metallic'].default_value=metal
 if 'Skin' in name:b.inputs['Subsurface Weight'].default_value=.055;b.inputs['Subsurface Radius'].default_value=(1,.45,.25)
 M[name]=m;return m

def par(o,p):o.parent=p or CUR;return o

def mesh(name,verts,faces,ma,p=None,sub=0):
 me=bpy.data.meshes.new(name);me.from_pydata(verts,[],faces);me.update();o=bpy.data.objects.new(name,me);scene.collection.objects.link(o);o.data.materials.append(M[ma]);par(o,p)
 for f in me.polygons:f.use_smooth=True
 if sub:
  mod=o.modifiers.new('Sculpted surface','SUBSURF');mod.levels=sub;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o

def sphere(name,loc,scale,ma,p=None,seg=24,rings=16):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,radius=1,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(M[ma]);par(o,p)
 for f in o.data.polygons:f.use_smooth=True
 return o

def cube(name,loc,scale,ma,p=None,bevel=.006):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(M[ma]);par(o,p)
 mod=o.modifiers.new('Tailored edge','BEVEL');mod.width=bevel;mod.segments=3;bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 for f in o.data.polygons:f.use_smooth=True
 o.modifiers.new('Corner normals','WEIGHTED_NORMAL');return o

def path(name,points,r,ma,p=None):
 c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=3;c.bevel_depth=r;c.bevel_resolution=1;s=c.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
 for bp,co in zip(s.bezier_points,points):bp.co=co;bp.handle_left_type='AUTO';bp.handle_right_type='AUTO'
 o=bpy.data.objects.new(name,c);scene.collection.objects.link(o);o.data.materials.append(M[ma]);par(o,p);bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');o.select_set(False);return o

def rings(name,rows,ma,p=None,n=32,sub=1,cloth=0):
 # Rows: z, horizontal radius, depth radius, horizontal offset, depth offset.
 vs=[];fs=[]
 for j,(z,rx,ry,cx,cy) in enumerate(rows):
  for i in range(n):
   a=i*2*pi/n;wr=1+cloth*sin(a*6+j*.8)*sin(pi*j/(len(rows)-1))
   vs.append((cx+rx*cos(a)*wr,cy+ry*sin(a)*wr,z))
 for j in range(len(rows)-1):
  for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 fs += [tuple(range(n-1,-1,-1)),tuple((len(rows)-1)*n+i for i in range(n))]
 return mesh(name,vs,fs,ma,p,sub)

def empty(name,loc,p=None):
 o=bpy.data.objects.new(name,None);scene.collection.objects.link(o);o.parent=p;o.location=loc;return o

def almond(name,x,y,z,width,height,ma,p):
 vs=[(x,y+.004,z)];ns=24
 for i in range(ns):
  a=2*pi*i/ns;vs.append((x+width*cos(a),y-.001*abs(cos(a)),z+height*sin(a)*(.82+.18*abs(sin(a)))))
 fs=[(0,i+1,(i+1)%ns+1) for i in range(ns)];return mesh(name,vs,fs,ma,p,1)

def make_head(v,head):
 fx=v['face'];hh=v['headheight'];n=64;vs=[];fs=[]
 # Adults: defined chin, jaw plane, cheekbone, temple, cranial vault.
 profile=[(.004,.030,.036,.004),(.012,.046,.050,.004),(.028,.066,.060,.001),(.048,.078,.066,-.002),(.070,.083,.074,-.005),(.098,.086,.081,-.009),(.127,.092,.084,-.010),(.151,.093,.086,-.013),(.173,.090,.085,-.014),(.192,.088,.084,-.014),(.216,.088,.083,-.015),(.240,.082,.077,-.015),(.259,.068,.066,-.016),(.274,.045,.046,-.016),(.281,.012,.014,-.016)]
 def frontal(x,z):
  return .008*exp(-((abs(x)-.058)/.021)**2-((z-.127)/.026)**2)-.006*exp(-((abs(x)-.036)/.022)**2-((z-.176)/.018)**2)+.007*exp(-(x/.047)**2-((z-.072)/.020)**2)
 for z,rx,ry,cy in profile:
  for i in range(n):
   a=i*2*pi/n;x=rx*cos(a);y=cy+ry*sin(a)
   # Gently flatten face instead of a sphere; sculpt cheek and eye planes.
   if sin(a)>0:y+=frontal(x,z)*sin(a)**3+.015*sin(a)**2
   vs.append((x*fx,y,z*hh))
 for j in range(len(profile)-1):
  for i in range(n):fs.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 fs+=[tuple(range(n-1,-1,-1)),tuple((len(profile)-1)*n+i for i in range(n))]
 mesh('Anatomy.Face',vs,fs,'Agent_Skin',head,1)
 # Integrated shaped nose bridge, alar wings and tip (no spherical button nose).
 nw=.013*v['nose'];rows=[(.104,.012,.079),(.109,.019,.089),(.119,.019,.106),(.126,.013,.119),(.137,.009,.110),(.158,.008,.091),(.184,.006,.083)]
 vs=[];fs=[];cols=12
 for z,w,y in rows:
  for i in range(cols+1):
   t=-1+2*i/cols;vs.append((t*w*v['nose']*fx,.077+(y-.077)*cos(t*pi/2)**.65,z*hh))
 for j in range(len(rows)-1):
  for i in range(cols):fs.append((j*(cols+1)+i,j*(cols+1)+i+1,(j+1)*(cols+1)+i+1,(j+1)*(cols+1)+i))
 mesh('Anatomy.NoseBridge',vs,fs,'Agent_Skin',head,1)
 for sg in [-1,1]:
  sphere('Anatomy.NoseAla',(sg*nw*.94,.091,.113*hh),(.008*v['nose'],.011,.007),'Agent_Skin',head,20,12)
  sphere('Anatomy.Nostril',(sg*nw*.86,.098,.1085*hh),(.0045,.002,.0018),'Agent_SkinShade',head,16,8)
  ex=sg*.036*fx;ez=.171*hh;ey=.080
  almond('Face.EyeWhite',ex,ey,ez,.0175,.0068,'Agent_EyeWhite',head)
  sphere('Face.Iris',(ex,ey+.0048,ez),(.0064,.0021,.0064),'Agent_Iris',head,20,12)
  sphere('Face.Pupil',(ex,ey+.0067,ez),(.0027,.001,.0033),'Agent_Pupil',head,16,10)
  sphere('Face.Catchlight',(ex-.0015,ey+.0075,ez+.002),(.0010,.0005,.001),'Agent_EyeWhite',head,12,8)
  upper=[(ex-.0175,.079,ez),(ex-.008,.085,ez+.0067),(ex+.006,.085,ez+.0071),(ex+.0175,.079,ez)]
  lower=[(ex-.0175,.079,ez),(ex-.007,.085,ez-.0055),(ex+.007,.084,ez-.0055),(ex+.0175,.079,ez)]
  path('Face.UpperEyelid',upper,.0027,'Agent_Skin',head);path('Face.LowerEyelid',lower,.0021,'Agent_Skin',head)
  path('Face.LashLine',[(x,y+.0016,z-.0011) for x,y,z in upper],.00085,'Agent_Hair',head)
  path('Face.Brow',[(ex-sg*.023,.080,.196*hh),(ex,.085,.202*hh),(ex+sg*.023,.075,.196*hh)],.0031*v['brows'],'Agent_Hair',head)
  # Ears with helix rim and antihelix, inset concha.
  sphere('Anatomy.Ear',(sg*.094*fx,-.012,.142*hh),(.018,.019,.036),'Agent_Skin',head,24,16)
  sphere('Anatomy.Concha',(sg*.104*fx,.0005,.141*hh),(.008,.014,.022),'Agent_SkinShade',head,20,12)
  path('Anatomy.EarHelix',[(sg*.096*fx,.003,.172*hh),(sg*.109*fx,.002,.163*hh),(sg*.111*fx,.000,.137*hh),(sg*.104*fx,.003,.117*hh)],.0038,'Agent_Skin',head)
  path('Anatomy.EarFold',[(sg*.104*fx,.007,.155*hh),(sg*.102*fx,.010,.143*hh),(sg*.106*fx,.009,.135*hh)],.0025,'Agent_Skin',head)
  if v.get('earrings'):
   sphere('Jewelry.Stud',(sg*.103*fx,.007,.115*hh),(.0033,.0035,.0033),'Agent_Metal',head,16,10)
  if v.get('age'):
   path('Face.UnderEyeCrease',[(ex-.015,.080,.153*hh),(ex,.083,.149*hh),(ex+.018,.077,.151*hh)],.0008,'Agent_SkinShade',head)
   path('Face.SmileFold',[(sg*.024,.088,.110*hh),(sg*.033,.083,.095*hh),(sg*.034,.078,.077*hh)],.00075,'Agent_SkinShade',head)
 # Closed lips: subdued natural lip colors and a clean mouth seam.
 mw=.027*v['lips']
 path('Face.UpperLip',[(-mw,.083,.075*hh),(-mw*.43,.093,.077*hh),(0,.095,.074*hh),(mw*.43,.093,.077*hh),(mw,.083,.075*hh)],.0027*v['lips'],'Agent_Lips',head)
 path('Face.LowerLip',[(-mw,.083,.073*hh),(-mw*.40,.093,.069*hh),(0,.095,.0685*hh),(mw*.40,.093,.069*hh),(mw,.083,.073*hh)],.0032*v['lips'],'Agent_Lips',head)
 path('Face.MouthSeam',[(-mw,.085,.074*hh),(0,.097,.072*hh),(mw,.085,.074*hh)],.00085,'Agent_SkinShade',head)
 if v.get('beard'):
  # Short, close facial hair follows jaw, with clean cheek and lip edges.
  for sg in [-1,1]:
   path('Hair.JawStubble',[(sg*.080*fx,.043,.097*hh),(sg*.070*fx,.055,.061*hh),(sg*.045*fx,.060,.036*hh),(sg*.017,.062,.029*hh)],.0075,'Agent_Hair',head)
   path('Hair.Moustache',[(sg*.003,.092,.092*hh),(sg*.015,.089,.091*hh),(sg*.026,.082,.086*hh)],.0029,'Agent_Hair',head)
  sphere('Hair.ChinStubble',(0,.065,.039*hh),(.025,.005,.008),'Agent_Hair',head,24,12)
 if v.get('glasses'):
  for sg in [-1,1]:
   ex=sg*.038*fx
   path('Eyewear.Frame',[(ex-.029,.095,.184*hh),(ex-.030,.096,.164*hh),(ex-.019,.099,.151*hh),(ex+.022,.098,.151*hh),(ex+.031,.094,.166*hh),(ex+.029,.095,.185*hh),(ex-.029,.095,.184*hh)],.0018,'Agent_Frames',head)
   path('Eyewear.Temple',[(sg*.067*fx,.094,.180*hh),(sg*.092*fx,.050,.179*hh),(sg*.098*fx,-.010,.164*hh)],.0018,'Agent_Frames',head)
  path('Eyewear.Bridge',[(-.012,.098,.181*hh),(0,.104,.185*hh),(.012,.098,.181*hh)],.0017,'Agent_Frames',head)
 # Hair cap follows a real scalp, with per-style hairline and lengths.
 def scalp_guard(x,y,z,a):
  z0=z/hh
  if profile[0][0]<=z0<=profile[-1][0]:
   for k in range(len(profile)-1):
    if profile[k][0]<=z0<=profile[k+1][0]:
     lo,hi=profile[k],profile[k+1];w=(z0-lo[0])/(hi[0]-lo[0]);rx=lo[1]+(hi[1]-lo[1])*w;ry=lo[2]+(hi[2]-lo[2])*w;cy=lo[3]+(hi[3]-lo[3])*w;break
   front=max(0,sin(a));sx=(rx+.0035)*fx*cos(a);sy=cy+(ry+.0045)*sin(a)+.015*front*front+frontal(rx*cos(a),z0)*front**3
   x=max(x,sx) if cos(a)>=0 else min(x,sx)
   y=max(y,sy) if sin(a)>=0 else min(y,sy)
  return x,y,z
 style=v['style'];rows=14;ns=64;verts=[(0,-.016,(.284 if style=='shaved' else .306)*hh)];faces=[]
 for j in range(1,rows+1):
  for i in range(ns):
   a=i*2*pi/ns;front=max(0,sin(a));back=max(0,-sin(a));side=abs(cos(a))
   theta=1.75-.63*front
   if style in ['bob','waves']:theta=2.20-1.18*front
   if style=='bun':theta=1.86-.98*front
   if style=='part':theta=1.80-.85*front+.18*cos(a)*front
   if style=='sweep':theta=1.75-.85*front+.20*cos(a)*front
   if style=='shaved':theta=1.70-.67*front
   t=theta*j/rows;vol=1.02
   zz=(.153+.151*cos(t))*hh
   if style in ['bob','waves']:zz-=.054*(1-front)*((j/rows)**5)
   xx=.102*fx*sin(t)*cos(a)*vol;yy=-.012+.101*sin(t)*sin(a)*vol
   if style=='shaved':
    z0=.153+.129*cos(t);zz=z0*hh
    lo,hi=profile[0],profile[-1]
    for k in range(len(profile)-1):
     if profile[k][0]<=z0<=profile[k+1][0]:lo,hi=profile[k],profile[k+1];break
    w=max(0,min(1,(z0-lo[0])/max(.0001,hi[0]-lo[0])));rx=lo[1]+(hi[1]-lo[1])*w;ry=lo[2]+(hi[2]-lo[2])*w;cy=lo[3]+(hi[3]-lo[3])*w
    xx=(rx+.0015)*fx*cos(a);yy=cy+(ry+.0015)*sin(a)+.015*front*front
   if style=='sweep':zz+=.021*max(0,cos(a))*sin(t)*front;xx+=.009*sin(t)*front
   verts.append(scalp_guard(xx,yy,zz,a))
 for i in range(ns):faces.append((0,1+i,1+(i+1)%ns))
 for j in range(rows-1):
  for i in range(ns):faces.append((1+j*ns+i,1+j*ns+(i+1)%ns,1+(j+1)*ns+(i+1)%ns,1+(j+1)*ns+i))
 mesh('Hair.Scalp',verts,faces,'Agent_Hair',head,1)
 if style in ['curls','coils']:
  count=155 if style=='coils' else 95
  for i in range(count):
   a=i*2.39996;t=math.acos(1-(i+.5)/count*1.22);front=max(0,sin(a))
   if t>1.78-.51*front:continue
   rr=.020 if style=='coils' else .012;rad=.122 if style=='coils' else .115
   x=rad*fx*sin(t)*cos(a);y=-.016+rad*.94*sin(t)*sin(a);z=(.153+(.181 if style=='coils' else .169)*cos(t))*hh
   sphere('Hair.IndividualCurl',(x,y,z),(rr,rr*.87,rr*.92),'Agent_HairLight' if i%9==0 else 'Agent_Hair',head,12,8)
 elif style=='bun':
  sphere('Hair.LowBun',(0,-.105,.151*hh),(.055,.046,.053),'Agent_Hair',head,32,20)
  for i in range(18):
   a=i*2*pi/18;path('Hair.BunStrand',[(.051*cos(a),-.117,.151*hh+.046*sin(a)),(.040*cos(a+.7),-.145,.151*hh+.039*sin(a+.7)),(.012*cos(a+1.4),-.150,.151*hh+.012*sin(a+1.4))],.0015,'Agent_HairLight',head)
 if style not in ['coils','curls','shaved']:
  for i in range(24):
   a=i*2*pi/24;front=max(0,sin(a));theta=(2.20-1.18*front) if style in ['bob','waves'] else (1.80-.85*front+.18*cos(a)*front);points=[]
   for k in range(8):
    t=.19+(theta-.19)*k/7;aa=a+.15*sin(t);x=.106*fx*sin(t)*cos(aa);y=-.012+.105*sin(t)*sin(aa);z=(.153+.154*cos(t))*hh
    if style in ['bob','waves']:z-=.055*(1-front)*(k/7)**5
    if style=='waves':x+=.008*sin(k*1.5)*(k/7)
    if style=='sweep':z+=.020*max(0,cos(aa))*sin(t)*front;x+=.009*sin(t)*front
    points.append(scalp_guard(x,y,z,aa))
   path('Hair.DirectionalStrand',points,.0008 if style not in ['waves','bob'] else .0010,'Agent_HairLight' if i%4==0 else 'Agent_Hair',head)

def make_resident(v):
 global CUR,M
 M={};skin=v['skin'];hair=v['hair'];shirt=v['shirt'];outfit=v['outfit'];build=v['build']
 material('Agent_Skin',tuple(c*.72 for c in skin),.65);material('Agent_SkinShade',tuple(c*.57 for c in skin),.72);material('Agent_Lips',(skin[0]*.52,skin[1]*.425,skin[2]*.482),.65)
 material('Agent_Hair',hair,.76);material('Agent_HairLight',tuple(min(.8,c*1.22+.008) for c in hair),.76)
 material('Agent_Shirt',tuple(c*.72 for c in shirt),.85);material('Agent_ShirtRib',tuple(c*.77 for c in shirt),.88);material('Agent_Seam',tuple(c*.84 for c in shirt),.88)
 material('Agent_Inner',(.62,.60,.54),.91);material('Agent_Undershirt',(.32,.35,.34),.91);material('Agent_Trousers',v['pants'],.89);material('Agent_Shoes',v['shoe'],.64);material('Agent_Sole',(.11,.095,.08),.85)
 material('Agent_EyeWhite',(.78,.77,.70),.36);material('Agent_Iris',(.10,.074,.043),.45);material('Agent_Pupil',(.006,.008,.009),.32);material('Agent_Metal',(.43,.31,.12),.34,.78);material('Agent_Frames',(.045,.037,.032),.43,.45)
 CUR=empty('AgentRoot',(0,0,0));CUR['resident_variant']=v['id'];CUR['asset_license']='CC0-1.0';CUR['forward']='-Z';CUR['units']='metres';CUR['style']='semi-realistic adult'
 body=empty('Body',(0,0,.84),CUR);head=empty('Head',(0,0,.52+v['neckOffset']),body);joint={'Body':body,'Head':head}
 # One continuous tailored torso with anatomical waist, ribcage, sloped shoulders.
 rows=[(-.017,.152*build,.095,0,0),(.008,.163*build,.106,0,0),(.032,.165*build,.108,0,0),(.090,.158*build,.107,0,0),(.185,.165*build,.112,0,.003),(.275,.185*build,.117,0,.003),(.365,.208,.120,0,0),(.423,.222,.107,0,-.005),(.452,.208,.098,0,-.005),(.480,.130,.084,0,-.004),(.495,.075,.064,0,0)]
 rings('Clothing.TailoredTorso',rows,'Agent_Shirt',body,n=40,sub=1,cloth=.008)
 # Neck emerging naturally from a close garment neckline.
 rings('Anatomy.Neck',[(.480,.052,.046,0,-.008),(.50,.049,.044,0,-.007),(.535+v['neckOffset']*.5,.046,.044,0,-.004),(.570+v['neckOffset'],.046,.046,0,0)],'Agent_Skin',body,n=28,sub=1)
 if outfit in ['knit']:
  rings('Clothing.RibHem',[(.003,.166*build,.109,0,0),(.027,.166*build,.110,0,0),(.035,.165*build,.109,0,0)],'Agent_ShirtRib',body,n=40,sub=0)
  path('Clothing.CrewNeck',[(-.065,0,.495),(-.055,.044,.492),(0,.063,.486),(.055,.044,.492),(.065,0,.495)],.009,'Agent_ShirtRib',body)
  for sg in [-1,1]:path('Clothing.ShoulderSeam',[(sg*.069,.040,.486),(sg*.148,.048,.468),(sg*.212,.049,.432)],.0014,'Agent_Seam',body)
 else:
  # Button placket and anatomically placed pointed collar/lapel panels.
  if outfit in ['blazer','cardigan']:
   mesh('Clothing.ShirtInset',[(-.045,.075,.496),(.045,.075,.496),(-.045,.118,.442),(.045,.118,.442),(-.034,.131,.395),(.034,.131,.395),(0,.132,.355)],[(0,1,3,2),(2,3,5,4),(4,5,6)],'Agent_Undershirt',body)
   for sg in [-1,1]:mesh('Clothing.Lapel',[(sg*.062,.074,.493),(sg*.143,.101,.429),(sg*.095,.126,.358),(sg*.024,.130,.258),(sg*.048,.126,.397)],[(0,1,2,3,4)],'Agent_ShirtRib',body)
   path('Clothing.JacketOpening',[(0,.119,.275),(0,.114,.15),(0,.109,.015)],.003,'Agent_ShirtRib',body)
  else:
   path('Clothing.ButtonPlacket',[(0,.079,.474),(0,.118,.394),(0,.123,.264),(0,.115,.112),(0,.111,.03)],.004,'Agent_ShirtRib',body)
   for sg in [-1,1]:mesh('Clothing.PointCollar',[(sg*.054,.043,.506),(sg*.095,.071,.472),(sg*.057,.118,.410),(sg*.012,.093,.472)],[(0,1,2,3)],'Agent_ShirtRib',body,1)
  for z in ([.265,.15] if outfit in ['blazer','cardigan'] else [.395,.316,.232,.147,.065]):sphere('Clothing.Button',(0,.128 if z>.2 else .117,z),(.0035,.002,.0035),'Agent_Metal',body,12,8)
  if outfit in ['oxford','overshirt','blazer']:
   for sg in ([1] if outfit=='oxford' else [-1,1]):
    z=.32 if outfit!='blazer' else .18;x=sg*(.105 if outfit!='blazer' else .082)
    def pocket_point(dx,pz):
     px=x+dx
     for low,high in zip(rows,rows[1:]):
      if low[0]<=pz<=high[0]:
       w=(pz-low[0])/(high[0]-low[0]);rx=low[1]+(high[1]-low[1])*w;ry=low[2]+(high[2]-low[2])*w;cy=low[4]+(high[4]-low[4])*w;break
     return (px,cy+ry*max(0,1-(px/rx)**2)**.5+.0018,pz)
    path('Clothing.PocketStitch',[pocket_point(-.027,z+.019),pocket_point(-.026,z-.032),pocket_point(0,z-.039),pocket_point(.026,z-.032),pocket_point(.027,z+.019)],.0017,'Agent_Seam',body)
    path('Clothing.PocketWelt',[pocket_point(-.028,z+.019),pocket_point(0,z+.018),pocket_point(.028,z+.019)],.003,'Agent_ShirtRib',body)
 make_head(v,head)
 # Rigid articulated anatomy preserves the exact original rest pivots.
 for side,sg in [('L',1),('R',-1)]:
  ua=empty('UpperArm.'+side,(sg*.226,0,.428),body);la=empty('LowerArm.'+side,(sg*.02,0,-.285),ua);hand=empty('Hand.'+side,(0,0,-.243),la)
  joint.update({ua.name:ua,la.name:la,hand.name:hand})
  # Source Blender: distal -Z, dorsal +Y, palm -Y; thumb is medial -sgX.
  # These exported landmarks are converted to glTF joint-local coordinates.
  hand['handAnatomy']={'schemaVersion':2,'coordinateSpace':'gltf_joint_local','rigLabel':side,'anatomicalSide':'right' if side=='L' else 'left','radialDirection':[-sg,0,0],'distalDirection':[0,-1,0],'palmarNormal':[0,0,1],'dorsalNormal':[0,0,-1],'wrist':[0,0,0],'palmCenter':[0,-.038,.0015],'thumbTip':[-sg*.049,-.061,.020],'indexTip':[sg*-.025,-.096,.010],'middleTip':[sg*-.0085,-.106,.010],'ringTip':[sg*.008,-.103,.010],'littleTip':[sg*.0245,-.091,.010],'fingerOrderRadialToUlnar':['index','middle','ring','little']}

  sphere('Clothing.ElbowContour',(0,0,-.003),(.048,.052,.066),'Agent_Shirt',la,24,16)
  rings('Clothing.UpperSleeve',[(.027,.010,.020,sg*-.030,0),(.021,.032,.048,sg*-.022,0),(.010,.055,.069,sg*-.014,0),(-.008,.067,.078,sg*.001,0),(-.050,.078,.084,sg*.008,0),(-.130,.066,.071,sg*.013,0),(-.205,.054,.060,sg*.018,0),(-.274,.049,.054,sg*.020,0),(-.291,.047,.052,sg*.020,0)],'Agent_Shirt',ua,sub=1,cloth=.013)
  rings('Clothing.ForeSleeve',[(.014,.049,.053,0,0),(-.015,.051,.055,0,0),(-.075,.050,.052,0,0),(-.145,.043,.047,0,0),(-.212,.036,.039,0,0),(-.236,.035,.037,0,0)],'Agent_Shirt',la,sub=1,cloth=.018)
  rings('Clothing.Cuff',[(-.202,.039,.042,0,0),(-.218,.039,.042,0,0),(-.236,.037,.040,0,0)],'Agent_ShirtRib',la,n=28,sub=0)
  for k in range(2):path('Clothing.ElbowFold',[(-.038,.034,-.029-k*.020),(0,.054,-.040-k*.015),(.035,.037,-.030-k*.017)],.0015,'Agent_Seam',la)
  # Flattened palm, separately shaped phalanges, understated nails and thumb.
  sphere('Anatomy.WristContour',(0,0,.001),(.027,.018,.027),'Agent_Skin',hand,24,16)
  rings('Anatomy.Hand',[(-.005,.029,.017,0,0),(-.024,.033,.019,0,0),(-.052,.033,.020,0,-.001),(-.067,.028,.017,0,-.003)],'Agent_Skin',hand,n=24,sub=1)
  for k in range(4):
   x=sg*(-.025+k*.0165);ln=[.036,.046,.043,.031][k];rr=.0073
   pts=[(x,-.002,-.060),(x,-.005,-.073),(x,-.009,-.060-ln*.72),(x,-.010,-.060-ln)]
   path('Anatomy.Finger',pts,rr,'Agent_Skin',hand);sphere('Anatomy.Fingertip',pts[-1],(.0066,.0071,.0077),'Agent_Skin',hand,16,10)
   sphere('Anatomy.Knuckle',(x,.012,-.069),(.008,.004,.007),'Agent_Skin',hand,16,10)
   sphere('Anatomy.Nail',(x,-.0025,-.055-ln),(.0045,.001,.006),'Agent_Inner',hand,12,8)
  path('Anatomy.Thumb',[(-sg*.025,-.006,-.027),(-sg*.043,-.012,-.041),(-sg*.049,-.020,-.061)],.011,'Agent_Skin',hand);sphere('Anatomy.ThumbTip',(-sg*.049,-.020,-.061),(.010,.010,.012),'Agent_Skin',hand,16,10)
  if side=='L':
   rings('Accessories.WatchStrap',[(-.213,.040,.043,0,0),(-.230,.040,.043,0,0)],'Agent_Frames',la,n=24,sub=0)
   cube('Accessories.WatchCase',(0,.043,-.221),(.025,.008,.024),'Agent_Metal',la,.004);cube('Accessories.WatchDial',(0,.048,-.221),(.020,.002,.018),'Agent_Frames',la,.003)
  thigh=empty('UpperLeg.'+side,(sg*.10,0,.007),body);knee=empty('LowerLeg.'+side,(0,0,-.376),thigh);foot=empty('Foot.'+side,(0,0,-.358),knee);joint.update({thigh.name:thigh,knee.name:knee,foot.name:foot})
  rings('Clothing.TrouserThigh',[(.014,.091,.093,0,0),(-.035,.092,.097,0,0),(-.120,.083,.087,0,0),(-.235,.068,.072,0,.002),(-.344,.059,.063,0,0),(-.383,.056,.061,0,0)],'Agent_Trousers',thigh,n=32,sub=1,cloth=.009)
  sphere('Clothing.KneeContour',(0,0,-.003),(.055,.060,.072),'Agent_Trousers',knee,24,16)
  rings('Clothing.TrouserCalf',[(.020,.055,.060,0,0),(-.026,.058,.062,0,0),(-.115,.059,.061,0,-.003),(-.217,.050,.054,0,-.002),(-.312,.041,.046,0,0),(-.356,.041,.045,0,0)],'Agent_Trousers',knee,n=32,sub=1,cloth=.016)
  path('Clothing.PressedCrease',[(0,.061,-.01),(0,.060,-.13),(0,.047,-.29)],.0011,'Agent_Trousers',knee)
  rings('Clothing.TrouserHem',[(-.322,.044,.048,0,0),(-.348,.044,.048,0,0)],'Agent_Trousers',knee,n=24,sub=0)
  cube('Footwear.Sole',(0,.040,-.088),(.128,.249,.030),'Agent_Sole',foot,.023)
  cube('Footwear.StitchedWelt',(0,.040,-.075),(.125,.244,.019),'Agent_Shoes',foot,.017)
  sphere('Footwear.LeatherUpper',(0,.040,-.051),(.064,.122,.043),'Agent_Shoes',foot,28,16)
  cube('Footwear.HeelCounter',(0,-.045,-.041),(.103,.066,.046),'Agent_Shoes',foot,.017)
  for q in range(3):path('Footwear.Lace',[(-.026,.019+q*.016,-.015),(0,.025+q*.016,-.010),(.026,.019+q*.016,-.015)],.0017,'Agent_Sole',foot)
  path('Footwear.ToeSeam',[(-.049,.088,-.033),(0,.102,-.022),(.049,.088,-.033)],.0011,'Agent_Sole',foot)
 # Store editable real animations, all 14 joint rotations plus pelvis translation.
 for clip,duration in CLIP_DURATIONS.items():
  for name,o in joint.items():
   o.animation_data_create();act=bpy.data.actions.new(clip+'_'+name);o.animation_data.action=act
   for f in range(round(duration*24)+1):
    rotations,bodypos=pose(clip,f/24);o.rotation_euler=rotations[name];o.keyframe_insert(data_path='rotation_euler',frame=f+1)
    if name=='Body':o.location=(bodypos[0],-bodypos[2],bodypos[1]);o.keyframe_insert(data_path='location',frame=f+1)
   for fc in act.fcurves:
    for kp in fc.keyframe_points:kp.interpolation='LINEAR'
   o.animation_data.action=None;tr=o.animation_data.nla_tracks.new();tr.name=clip;st=tr.strips.new(clip,1,act);tr.mute=True
   o.rotation_euler=(0,0,0)
   if name=='Body':o.location=(0,0,.84)
 scene.frame_set(1);return CUR,joint

def export_resident(v):
 root,joint=make_resident(v);obs=[root]+list(root.children_recursive)
 # Authoring blend deliberately retains individual anatomical, garment and hair pieces.
 bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SOURCE,'agent-'+v['id']+'.blend'),compress=True)
 # Optimize runtime by articulated parent; multiple material slots keep semantic palettes.
 for p in list(joint.values()):
  meshes=[o for o in p.children if o.type=='MESH']
  if not meshes:continue
  bpy.ops.object.select_all(action='DESELECT')
  for o in meshes:o.select_set(True)
  bpy.context.view_layer.objects.active=meshes[0]
  if len(meshes)>1:bpy.ops.object.join()
  meshes[0].name=p.name+'.ResidentGeometry'
  # Editable source retains sculpt tessellation; runtime reduces redundant microgeometry.
  mod=meshes[0].modifiers.new('Realtime surface budget','DECIMATE');mod.ratio=.78 if p.name=='Head' else .67;mod.use_collapse_triangulate=True
  bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.modifier_apply(modifier=mod.name)
 bpy.context.view_layer.update();meshes=[o for o in root.children_recursive if o.type=='MESH']
 coords=[o.matrix_world@Vector(c) for o in meshes for c in o.bound_box];lo=[min(v[i] for v in coords) for i in range(3)];hi=[max(v[i] for v in coords) for i in range(3)]
 bpy.ops.object.select_all(action='DESELECT')
 for o in [root]+list(root.children_recursive):o.select_set(True)
 bpy.context.view_layer.objects.active=root;p=os.path.join(OUT,'agent-'+v['id']+'.glb')
 bpy.ops.export_scene.gltf(filepath=p,export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_animations=False,export_extras=True)
 j=inject_clips(p);tri=sum(sum(j['accessors'][p['indices']]['count']//3 for p in m['primitives']) for m in j['meshes'])
 result=dict(id=v['id'],file='agent-'+v['id']+'.glb',label=v['label'],standingHeightMetres=round(hi[2]-lo[2],4),neckOffsetMetres=v['neckOffset'],headProportionScale=v['headheight'],torsoWidthScale=v['build'],bounds={'minXYZ':[round(lo[0],4),round(lo[2],4),round(-hi[1],4)],'maxXYZ':[round(hi[0],4),round(hi[2],4),round(-lo[1],4)]},meshCount=len(j['meshes']),drawPrimitives=sum(len(m['primitives']) for m in j['meshes']),triangles=tri,bytes=os.path.getsize(p),clips=len(j['animations']),materials=[m['name'] for m in j['materials']])
 print('RESIDENT',json.dumps(result),flush=True)
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 for m in list(bpy.data.materials):bpy.data.materials.remove(m)
 for a in list(bpy.data.actions):bpy.data.actions.remove(a)
 return result

if __name__=='__main__':
 results=[export_resident(v) for v in VARIANTS]
 import shutil
 shutil.copyfile(os.path.join(OUT,'agent-01.glb'),os.path.join(OUT,'agent.glb'))
 contract={'version':1,'authorship':'Original procedural anatomy, clothing, hair and accessories authored for Pi Office. No scans, photographs, external models or textures.','license':'CC0-1.0','runtimeSchema':'/models/agent-01.glb through /models/agent-08.glb; agent.glb aliases variant 01. Stable ID hashing should choose the URL. Preserve authored palettes.','root':'AgentRoot','units':'metres','up':'+Y','forward':'-Z','standingPelvisY':.84,'seatedPelvisY':.55,'deskChairOffsetZ':.74,'jointNames':joints,'handContract':HAND_CONTRACT,'clipDurationsSeconds':CLIP_DURATIONS,'variants':results}
 with open(os.path.join(SOURCE,'resident-variants.json'),'w') as f:json.dump(contract,f,indent=2);f.write('\n')
 # Keep the public contract synchronized with every deterministic rebuild.
 mp=os.path.join(OUT,'asset-manifest.json')
 if os.path.exists(mp):
  manifest=json.load(open(mp))
  for v in results:
   lo=v['bounds']['minXYZ'];hi=v['bounds']['maxXYZ']
   entry={'file':v['file'],'root':'AgentRoot','sizeXYZ':[round(b-a,4) for a,b in zip(lo,hi)],'minXYZ':lo,'maxXYZ':hi,'meshes':v['meshCount'],'drawPrimitives':v['drawPrimitives'],'triangles':v['triangles'],'bytes':v['bytes'],'license':'CC0-1.0'}
   manifest['assets']['agent-'+v['id']]=entry
   if v['id']=='01':manifest['assets']['agent']={**entry,'file':'agent.glb','aliasOf':'agent-01.glb'}
  manifest['agent'].update({'leftIsPositiveX':False,'rigPositiveXLabel':'L','anatomicalRightIsPositiveX':True,'handContract':HAND_CONTRACT,'height':results[0]['standingHeightMetres'],'variantCount':8,'variantSelection':'Stable agent identity hash selects agent-01.glb through agent-08.glb; preserve authored palettes.','standingRootOffsetY':.04,'seatedRootOffsetY':.05,'variants':results,'geometryStyle':'Original semi-realistic adult rigid-joint geometry. Shared contact rig; neck, head, build, hair and clothing vary.','license':'CC0-1.0'})
  with open(mp,'w') as f:json.dump(manifest,f,indent=2);f.write('\n')
 print('ALL RESIDENTS EXPORTED',flush=True)

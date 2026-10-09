"""Make reliable full-pose glTF clips, independent of Blender NLA optimizations."""
import json,math,struct,os
BASE=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p=os.path.join(BASE,'public/models/agent.glb')
def mul(a,b):
 x,y,z,w=a;X,Y,Z,W=b
 return (w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z)
def quat(v):
 x,y,z=v;q=mul(mul((0,0,math.sin(z/2),math.cos(z/2)),(0,math.sin(y/2),0,math.cos(y/2))),(math.sin(x/2),0,0,math.cos(x/2)))
 return(q[0],q[2],-q[1],q[3])
f=open(p,'rb');f.read(12);n,t=struct.unpack('<II',f.read(8));j=json.loads(f.read(n));n,t=struct.unpack('<II',f.read(8));blob=bytearray(f.read(n))
# Remove previously generated tail animation buffers for idempotent rebuilds.
if j.get('animations'):
 olda={sam[k] for an in j['animations'] for sam in an['samplers'] for k in ['input','output']}
 oldb={j['accessors'][a]['bufferView'] for a in olda}
 if olda==set(range(min(olda),len(j['accessors']))) and oldb==set(range(min(oldb),len(j['bufferViews']))):
  blob=blob[:min(j['bufferViews'][b].get('byteOffset',0) for b in oldb)];j['accessors']=j['accessors'][:min(olda)];j['bufferViews']=j['bufferViews'][:min(oldb)]
joints=['Body','Head']+[n+'.'+s for s in ['L','R'] for n in ['UpperArm','LowerArm','Hand','UpperLeg','LowerLeg','Foot']]
ids={v['name']:i for i,v in enumerate(j['nodes']) if v.get('name') in joints}
for name,i in ids.items():
 j['nodes'][i].pop('rotation',None)
 if name=='Body':j['nodes'][i]['translation']=[0,.84,0]
def arr(vals,kind):
 while len(blob)%4:blob.append(0)
 start=len(blob);flat=[q for v in vals for q in v] if isinstance(vals[0],(tuple,list)) else vals
 blob.extend(struct.pack('<'+'f'*len(flat),*flat));bv=len(j['bufferViews']);j['bufferViews'].append({'buffer':0,'byteOffset':start,'byteLength':len(flat)*4})
 a={'bufferView':bv,'componentType':5126,'count':len(vals),'type':kind}
 if kind=='SCALAR':a['min']=[min(vals)];a['max']=[max(vals)]
 ix=len(j['accessors']);j['accessors'].append(a);return ix
CLIP_DURATIONS={'Idle':2,'Walk':1,'Work':1,'Wave':2,'WaveSeated':2,'IdleSeated':2,'ThinkSeated':6,'WaitSeated':6,'ErrorSeated':5,'DoneSeated':6,'OfflineSeated':4}
STATE_CLIPS={'ThinkSeated','WaitSeated','ErrorSeated','DoneSeated','OfflineSeated'}
def smooth(x):
 x=max(0,min(1,x));return x*x*(3-2*x)
def gesture(t,start,rise,hold,fall):
 return smooth((t-start)/rise)*(1-smooth((t-start-rise-hold)/fall))
def mix(a,b,w):return tuple(x+(y-x)*w for x,y in zip(a,b))
def pose(clip,t):
 rot={n:(0,0,0) for n in joints};body=[0,.84,0]
 if clip=='Idle':
  q=math.sin(2*math.pi*t/2);body[1]+=.004*(1-math.cos(2*math.pi*t/2));rot['Head']=(.008*q,0,.025*q)
  rot['UpperArm.L']=(.015*q,0,0);rot['UpperArm.R']=(-.015*q,0,0)
 elif clip=='Walk':
  ph=2*math.pi*t;body[1]+=.023*abs(math.sin(ph));rot['Body']=(0,0,.025*math.sin(ph))
  for s,sg in [('L',1),('R',-1)]:
   swing=sg*math.cos(ph);rot['UpperLeg.'+s]=(.54*swing,0,0);rot['LowerLeg.'+s]=(-.12-.53*max(0,-sg*math.sin(ph)),0,0);rot['UpperArm.'+s]=(-.48*swing,0,0);rot['LowerArm.'+s]=(.20,0,0)
 elif clip in ['Work','WaveSeated','IdleSeated'] or clip in STATE_CLIPS:
  body[1]=.55+.002*math.sin(2*math.pi*t);rot['Head']=(.08,0,.015*math.sin(2*math.pi*t))
  for s,sg in [('L',1),('R',-1)]:
   rot['UpperLeg.'+s]=(1.32,0,0);rot['LowerLeg.'+s]=(-1.32,0,0);rot['UpperArm.'+s]=(.8,0,0);rot['LowerArm.'+s]=(1.0+sg*.035*math.sin(4*math.pi*t),0,0);rot['Hand.'+s]=(-.23+sg*.04*math.sin(4*math.pi*t),0,0)
 if clip=='IdleSeated' or clip in STATE_CLIPS:
  for side in ['L','R']:
   rot['LowerArm.'+side]=(1.0,0,0);rot['Hand.'+side]=(-.23,0,0)
 if clip in STATE_CLIPS:
  duration=CLIP_DURATIONS[clip];phase=2*math.pi*t/duration
  body[1]=.55+.0012*math.sin(phase);rot['Head']=(-.015,0,.009*math.sin(phase))
  if clip=='ThinkSeated':
   w=gesture(t,.35,1.10,2.50,1.10)
   rot['UpperArm.R']=mix((.8,0,0),(.8,0,-.30),w)
   rot['LowerArm.R']=mix((1.,0,0),(2.60,.50,0),w)
   rot['Hand.R']=mix((-.23,0,0),(-.20,0,.12),w)
   rot['Head']=(-.04-.04*w,-.075*w,.035*w+.01*math.sin(phase))
  elif clip=='WaitSeated':
   w=gesture(t,1.0,.85,1.20,.85)
   rot['UpperArm.L']=mix((.8,0,0),(1.12,0,.28),w)
   rot['LowerArm.L']=mix((1.,0,0),(1.37,-.30,0),w)
   rot['Hand.L']=mix((-.23,0,0),(-.37,0,0),w)
   rot['Head']=(-.025-.16*w,0,-.13*w+.012*math.sin(phase))
  elif clip=='ErrorSeated':
   w=gesture(t,.25,.30,1.40,.55)
   rot['Head']=(-.055,0,.105*math.sin(2*math.pi*(t-.25)/.90)*w)
   rot['UpperArm.L']=(.77,0,0);rot['UpperArm.R']=(.77,0,0)
  elif clip=='DoneSeated':
   w=gesture(t,.20,.50,.35,.75)
   rot['UpperArm.R']=mix((.8,0,0),(.95,.32,0),w)
   rot['LowerArm.R']=mix((1.,0,0),(1.70,0,0),w)
   rot['Hand.R']=mix((-.23,0,0),(-.12,0,-.08),w)
   nod=-.10*math.sin(math.pi*min(1,max(0,(t-.30)/.85))) if t<1.15 else 0
   rot['Head']=(-.015+nod,0,-.025*w)
  elif clip=='OfflineSeated':
   body[1]=.55;rot['Head']=(-.05,0,0)
   for side in ['L','R']:
    rot['UpperArm.'+side]=(.76,0,0);rot['LowerArm.'+side]=(1.04,0,0);rot['Hand.'+side]=(-.23,0,0)
 if clip in ['Wave','WaveSeated']:

  fade=min(1,t/.3,(2-t)/.3);fade=max(0,fade)
  rot['UpperArm.R']=(.12*fade,2.44*fade,0);rot['LowerArm.R']=(.15*fade,.18*math.sin(t*6*math.pi)*fade,0);rot['Head']=(0,.06*fade,-.09*fade)
 return rot,body
j['animations']=[]
for clip,duration in CLIP_DURATIONS.items():
 times=[i/24 for i in range(round(duration*24)+1)];states=[pose(clip,t) for t in times];ta=arr(times,'SCALAR');a={'name':clip,'samplers':[],'channels':[]}
 for name in joints:
  oa=arr([quat(s[0][name]) for s in states],'VEC4');si=len(a['samplers']);a['samplers'].append({'input':ta,'output':oa,'interpolation':'LINEAR'});a['channels'].append({'sampler':si,'target':{'node':ids[name],'path':'rotation'}})
 oa=arr([s[1] for s in states],'VEC3');si=len(a['samplers']);a['samplers'].append({'input':ta,'output':oa,'interpolation':'LINEAR'});a['channels'].append({'sampler':si,'target':{'node':ids['Body'],'path':'translation'}});j['animations'].append(a)
j['buffers'][0]['byteLength']=len(blob)
js=json.dumps(j,separators=(',',':')).encode();js+=b' '*((-len(js))%4);blob+=b'\0'*((-len(blob))%4)
with open(p,'wb') as f:f.write(struct.pack('<III',0x46546c67,2,12+8+len(js)+8+len(blob)));f.write(struct.pack('<II',len(js),0x4e4f534a));f.write(js);f.write(struct.pack('<II',len(blob),0x004e4942));f.write(blob)
print('Validated agent full-pose clips:',[(a['name'],len(a['channels'])) for a in j['animations']]);print('Base standing pelvis:',j['nodes'][ids['Body']]['translation'])

mp=os.path.join(BASE,'public/models/asset-manifest.json')
if os.path.exists(mp):
 manifest=json.load(open(mp));manifest['animations']=list(CLIP_DURATIONS);manifest['assets']['agent']['bytes']=os.path.getsize(p);manifest['agent']['clipDurationsSeconds']=CLIP_DURATIONS
 manifest['agent']['stateAnimationMap']={'working':'Work','thinking':'ThinkSeated','waiting':'WaitSeated','idle':'IdleSeated','error':'ErrorSeated','done':'DoneSeated','offline':'OfflineSeated'}
 manifest['agent']['animationPlaybackNotes']={'DoneSeated':'Play once on state entry, then IdleSeated while done remains.','ErrorSeated':'Brief restrained shake then calm. Play once and hold or loop slowly.','ThinkSeated':'Seamless six-second cycle with a held chin gesture.','WaitSeated':'Seamless six-second cycle with a brief wrist check.','OfflineSeated':'Exactly static pose. Safe to sample once and stop its mixer.','reducedMotion':'Freeze state pose; root movement is application-owned.'}
 with open(mp,'w') as f:json.dump(manifest,f,indent=2);f.write('\n')

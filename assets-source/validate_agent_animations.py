"""Verify every exported animation sample, hierarchy, finite transforms and full-pose bounds."""
import os,json,struct,math
import numpy as np
B=os.path.dirname(os.path.dirname(os.path.abspath(__file__)));p=os.path.join(B,'public/models/agent.glb')
with open(p,'rb') as f:
 header=struct.unpack('<III',f.read(12));assert header==(0x46546c67,2,os.path.getsize(p))
 n,_=struct.unpack('<II',f.read(8));j=json.loads(f.read(n));n,_=struct.unpack('<II',f.read(8));blob=f.read(n)
def acc(i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];dims={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']];off=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',4*dims)
 return np.ndarray((a['count'],dims),dtype='<f4',buffer=blob,offset=off,strides=(stride,4)).copy()
def transform(t,q,scale):
 x,y,z,w=q;m=np.eye(4);m[:3,:3]=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])@np.diag(scale);m[:3,3]=t;return m
parents={c:i for i,n in enumerate(j['nodes']) for c in n.get('children',[])};verts={}
for i,n in enumerate(j['nodes']):
 if 'mesh' in n:verts[i]=np.concatenate([acc(p['attributes']['POSITION']) for p in j['meshes'][n['mesh']]['primitives']])
report={'file':'public/models/agent.glb','bytes':os.path.getsize(p),'meshCount':len(j['meshes']),'jointCount':14,'clips':[]}
for clip in j['animations']:
 assert len(clip['channels'])==15,clip['name'];channels=[]
 for ch in clip['channels']:
  s=clip['samplers'][ch['sampler']];times=acc(s['input'])[:,0];vals=acc(s['output']);assert np.isfinite(vals).all()
  if ch['target']['path']=='rotation':assert np.allclose(np.linalg.norm(vals,axis=1),1,atol=1e-5)
  channels.append((ch['target']['node'],ch['target']['path'],times,vals))
 count=len(channels[0][2]);assert all(len(c[2])==count for c in channels)
 lo=np.full(3,np.inf);hi=-lo;maxseam=0
 for _,_,_,v in channels:maxseam=max(maxseam,float(np.abs(v[0]-v[-1]).max()))
 for f in range(count):
  overrides={(node,path):v[f] for node,path,_,v in channels};world={}
  def matrix(i):
   if i in world:return world[i]
   n=j['nodes'][i];m=transform(overrides.get((i,'translation'),n.get('translation',[0,0,0])),overrides.get((i,'rotation'),n.get('rotation',[0,0,0,1])),n.get('scale',[1,1,1]))
   world[i]=matrix(parents[i])@m if i in parents else m;return world[i]
  for i,v in verts.items():
   m=matrix(i);w=v@m[:3,:3].T+m[:3,3];lo=np.minimum(lo,w.min(axis=0));hi=np.maximum(hi,w.max(axis=0))
 assert lo[1]>-.02,(clip['name'],'floor penetration',lo[1]);assert hi[1]<2.2,(clip['name'],'height',hi[1])
 assert np.max(hi-lo)<2.5,(clip['name'],'unexpected extreme bounds',hi-lo)
 if clip['name']=='OfflineSeated':assert all(np.array_equal(v,np.broadcast_to(v[0],v.shape)) for _,_,_,v in channels)
 report['clips'].append({'name':clip['name'],'channels':len(channels),'framesChecked':count,'durationSeconds':float(times[-1]),'minXYZ':lo.round(4).tolist(),'maxXYZ':hi.round(4).tolist(),'loopSeamMaxComponentDifference':round(maxseam,9)})
 print(clip['name'],count,'frames OK, bounds',lo.round(3),hi.round(3),'seam',round(maxseam,6))
with open(os.path.join(B,'assets-source/agent-animation-validation.json'),'w') as f:json.dump(report,f,indent=2);f.write('\n')

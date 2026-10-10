"""Validate a targeted hand revision against a saved pre-revision export set.
python assets-source/validate_hand_revision.py /path/to/prior/glbs
The reference directory is explicit: there is no model/network download.
"""
import sys,json,struct,hashlib,math
from pathlib import Path
B=Path(__file__).resolve().parent.parent
reference=Path(sys.argv[1])

def read(p):
 data=p.read_bytes();n=struct.unpack_from('<I',data,12)[0];j=json.loads(data[20:20+n]);off=20+n;n=struct.unpack_from('<I',data,off)[0];return j,data[off+8:off+8+n],data

def data(j,b,i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];width={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}[a['type']]*{5121:1,5123:2,5125:4,5126:4}[a['componentType']];off=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',width)
 return b''.join(b[off+k*stride:off+k*stride+width] for k in range(a['count']))

def motions(j,b):
 out={}
 for an in j['animations']:
  for ch in an['channels']:
   sampler=an['samplers'][ch['sampler']];key=an['name']+':'+j['nodes'][ch['target']['node']]['name']+':'+ch['target']['path'];out[key]=(data(j,b,sampler['input']),data(j,b,sampler['output']))
 return out

def geometry(j,b):
 out={}
 for n in j['nodes']:
  if 'mesh' not in n:continue
  parts={}
  for p in j['meshes'][n['mesh']]['primitives']:
   ma=j['materials'][p['material']]['name'];verts=list(struct.iter_unpack('<fff',data(j,b,p['attributes']['POSITION'])));parts[ma]=(verts,j['accessors'][p['indices']]['count'])
  out[n['name']]=parts
 return out

def max_point_delta(a,b,tolerance=.005):
 # Exporter vertex order and symmetric decimation triangulation are not stable.
 # Compare the actual surfaces' vertex clouds, not unrelated buffer ordering.
 source=set(a);bins={}
 for p in source:bins.setdefault(tuple(math.floor(v/tolerance) for v in p),[]).append(p)
 maximum=0
 for p in set(b)-source:
  cell=tuple(math.floor(v/tolerance) for v in p);best=float('inf')
  for dx in [-1,0,1]:
   for dy in [-1,0,1]:
    for dz in [-1,0,1]:
     for q in bins.get((cell[0]+dx,cell[1]+dy,cell[2]+dz),[]):best=min(best,sum((x-y)**2 for x,y in zip(p,q))**.5)
  assert best<=tolerance,('Unrelated geometry changed beyond export tolerance',best)
  maximum=max(maximum,best)
 return maximum

allowed={'Wave:Hand.R:rotation','WaveSeated:Hand.R:rotation'}
reports=[]
manifest=json.loads((B/'public/models/asset-manifest.json').read_text())
for ix in range(1,9):
 name=f'agent-{ix:02d}.glb';old=read(reference/name);new=read(B/'public/models'/name);om=motions(*old[:2]);nm=motions(*new[:2]);assert om.keys()==nm.keys()
 changed={k for k in om if om[k]!=nm[k]};assert changed==allowed,(name,changed)
 assert all(om[k][0]==nm[k][0] for k in om),'Animation sample times changed'
 og=geometry(*old[:2]);ng=geometry(*new[:2]);assert og.keys()==ng.keys();maximum=0;retessellation=[]
 for mesh in og:
  if mesh in ['Hand.L.ResidentGeometry','Hand.R.ResidentGeometry']:continue
  assert og[mesh].keys()==ng[mesh].keys()
  for ma,(vertices,indices) in og[mesh].items():
   nv,ni=ng[mesh][ma]
   if len(vertices)!=len(nv) or indices!=ni:retessellation.append({'mesh':mesh,'material':ma,'verticesBefore':len(vertices),'verticesAfter':len(nv),'indicesBefore':indices,'indicesAfter':ni})
   maximum=max(maximum,max_point_delta(vertices,nv),max_point_delta(nv,vertices))
 oldnodes={n['name']:n for n in old[0]['nodes']};newnodes={n['name']:n for n in new[0]['nodes']}
 for name0,n in oldnodes.items():
  if '.ResidentGeometry' in name0:continue
  for k in ['translation','rotation','scale']:assert n.get(k)==newnodes[name0].get(k),(name,name0,k)
 for side,sg in [('L',1),('R',-1)]:
  a=newnodes['Hand.'+side]['extras']['handAnatomy'];assert a['thumbTip'][0]*sg<0
  assert abs(a['thumbTip'][0]-a['indexTip'][0])<abs(a['thumbTip'][0]-a['littleTip'][0]);assert a['middleTip'][1]<a['ringTip'][1]<a['indexTip'][1]<a['littleTip'][1]
 assert manifest['assets'][f'agent-{ix:02d}']['bytes']==len(new[2])
 reports.append({'file':'public/models/'+name,'sha256':hashlib.sha256(new[2]).hexdigest(),'referenceSha256':hashlib.sha256(old[2]).hexdigest(),'bytes':len(new[2]),'intentionallyChangedMeshes':['Hand.L.ResidentGeometry','Hand.R.ResidentGeometry'],'maxNonHandVertexDeltaMetres':maximum,'nonHandComparisonToleranceMetres':.005,'nonHandRetessellation':retessellation,'changedAnimationOutputs':sorted(changed),'allOtherAnimationPayloadsIdentical':True,'jointRestTransformsIdentical':True,'clips':len(new[0]['animations'])})
assert (B/'public/models/agent.glb').read_bytes()==(B/'public/models/agent-01.glb').read_bytes()
report={'check':'Targeted hand pronation/chirality revision. Two hand meshes were intentionally changed; standard Blender regeneration may reorder vertices or retessellate symmetric details. Non-hand material sets are unchanged. Export retessellation count differences and bidirectional vertex-cloud deviations are reported per file. All joint rest transforms, animation sample times and animation outputs remain byte-identical except Wave/WaveSeated Hand.R rotation outputs.','handContract':manifest['agent']['handContract'],'variants':reports}
(B/'assets-source/resident-contract-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print('All8: hand-only intended geometry edits; non-hand shape drift bounded at',max(r['maxNonHandVertexDeltaMetres'] for r in reports),'metres. Exactly two wave hand rotation outputs changed; other animations/joints preserved.')

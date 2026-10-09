"""Share identical imported mesh data in the optional editable layout preview."""
import bpy,os,hashlib,array,re
B=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p=os.path.join(B,'assets-source/pi-office-cubicles.blend');bpy.ops.wm.open_mainfile(filepath=p)
seen={}
for o in list(bpy.data.objects):
 if o.type!='MESH':continue
 m=o.data;coords=array.array('f',[0])*(len(m.vertices)*3);m.vertices.foreach_get('co',coords)
 indices=array.array('i',[0])*len(m.loops);m.loops.foreach_get('vertex_index',indices)
 polys=array.array('i',[0])*len(m.polygons);m.polygons.foreach_get('material_index',polys)
 key=hashlib.sha256(coords.tobytes()+indices.tobytes()+polys.tobytes()+'|'.join(re.sub(r'\.\d+$','',x.name)for x in m.materials if x).encode()).hexdigest()
 if key in seen:o.data=seen[key]
 else:seen[key]=m
for _ in range(3):bpy.ops.outliner.orphans_purge(do_local_ids=True,do_linked_ids=True,do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=p,compress=True)
print('shared meshes',len(seen),'bytes',os.path.getsize(p))

import bpy,os
B=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s=bpy.context.scene;s.cycles.use_denoising=False;s.cycles.samples=96;s.render.image_settings.file_format='PNG'
for camera,name,w,h in [('Camera.RoomOverview','blender-room-overview',1000,800),('Camera.WorkstationDetail','blender-workstation-closeup',900,800),('Camera.CharacterDetail','blender-character-closeup',700,900)]:
 s.camera=bpy.data.objects[camera];s.render.resolution_x=w;s.render.resolution_y=h;s.render.filepath=os.path.join(B,'asset-renders',name+'.png');bpy.ops.render.render(write_still=True)
s.camera=bpy.data.objects['Camera.RoomOverview'];bpy.ops.wm.save_as_mainfile(filepath=os.path.join(B,'assets-source','pi-office-studio.blend'),compress=True)

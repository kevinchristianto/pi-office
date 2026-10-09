"""Add the exact exported state motions to the editable Blender source rig."""
import bpy,os,runpy
B=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
author=runpy.run_path(os.path.join(B,'assets-source','finalize_agent.py'));pose=author['pose'];durations=author['CLIP_DURATIONS'];names=author['joints'];scene=bpy.context.scene;frame=scene.frame_current
saved={n:(bpy.data.objects[n].location.copy(),bpy.data.objects[n].rotation_euler.copy()) for n in names}
for clip in ['ThinkSeated','WaitSeated','ErrorSeated','DoneSeated','OfflineSeated']:
 duration=durations[clip]
 for name in names:
  o=bpy.data.objects[name];o.animation_data_create()
  for tr in list(o.animation_data.nla_tracks):
   if tr.name==clip:o.animation_data.nla_tracks.remove(tr)
  action_name=clip+'_'+name
  if action_name in bpy.data.actions:bpy.data.actions.remove(bpy.data.actions[action_name])
  action=bpy.data.actions.new(action_name);o.animation_data.action=action
  for f in range(round(duration*24)+1):
   rotations,body=pose(clip,f/24);o.rotation_euler=rotations[name];o.keyframe_insert(data_path='rotation_euler',frame=f+1)
   if name=='Body':o.location=(body[0],-body[2],body[1]);o.keyframe_insert(data_path='location',frame=f+1)
  for fc in action.fcurves:
   for k in fc.keyframe_points:k.interpolation='LINEAR'
  o.animation_data.action=None;tr=o.animation_data.nla_tracks.new();tr.name=clip;strip=tr.strips.new(clip,1,action);strip.action_frame_start=1;strip.action_frame_end=duration*24+1;tr.mute=True
for name,(loc,rot) in saved.items():bpy.data.objects[name].location=loc;bpy.data.objects[name].rotation_euler=rot
scene.frame_set(frame)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(B,'assets-source','pi-office-studio.blend'),compress=True)

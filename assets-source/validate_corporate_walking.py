"""Validate saved walking review without rendering or changing its source file.
Run from project root:
  blender -b assets-source/corporate-office-walking-review.blend --python assets-source/validate_corporate_walking.py
"""
import bpy
import hashlib
import json
import math
import os
import subprocess
import sys
from fractions import Fraction

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(BASE, 'assets-source/corporate-layout.json')) as stream:
    snapshot = json.load(stream)
review = snapshot['scenes']['detail']['walkingReview']
scene = bpy.context.scene
roots = [obj for obj in scene.objects if obj.get('source_glb') == review['model'] + '.glb']
assert len(roots) == 1, 'Review requires exactly one moving subject instance.'
root = roots[0]
meshes = [obj for obj in root.children_recursive if obj.type == 'MESH']
assert meshes, 'The subject must use the actual imported resident meshes.'
assert scene.render.fps == review['fps']
assert scene.frame_end - scene.frame_start + 1 == len(review['samples'])
assert not any(curve.data_path == 'scale' for curve in root.animation_data.action.fcurves)
maximum_position_error = 0
maximum_yaw_error = 0
maximum_heading_step = 0
previous_sample = None
for sample in review['samples']:
    scene.frame_set(sample['frame'])
    expected = (sample['position'][0], -sample['position'][2], sample['position'][1])
    error = math.dist(tuple(root.location), expected)
    maximum_position_error = max(maximum_position_error, error)
    assert error < 1e-5, ('Position mismatch', sample['frame'], error)
    assert all(abs(value - 1) < 1e-7 for value in root.scale), 'Actor scaling is prohibited.'
    assert all(obj.hide_render == (not sample['visible']) for obj in meshes)
    yaw_error = (root.rotation_euler.z - sample['yaw'] + math.pi) % (2 * math.pi) - math.pi
    maximum_yaw_error = max(maximum_yaw_error, abs(yaw_error))
    assert abs(yaw_error) < 1e-5, ('Yaw mismatch', sample['frame'])
    if previous_sample is not None:
        interval = sample['time'] - previous_sample['time']
        heading_step = abs((sample['yaw'] - previous_sample['yaw'] + math.pi) % (2 * math.pi) - math.pi)
        maximum_heading_step = max(maximum_heading_step, heading_step)
        assert heading_step <= review['turnSpeedRadiansPerSecond'] * interval + 1e-7, ('Heading discontinuity', sample['frame'], heading_step)
        distance_step = abs(sample['distance'] - previous_sample['distance'])
        assert distance_step <= review['speed'] * interval + 1e-7, ('Movement discontinuity', sample['frame'], distance_step)
        if sample['clip'] == previous_sample['clip']:
            rate = review['walkGaitRate'] if sample['clip'] == 'Walk' else 1
            assert abs(sample['clipTime'] - previous_sample['clipTime'] - interval * rate) < 1e-7, ('Gait clock mismatch', sample['frame'])
    previous_sample = sample
for filename, expected in snapshot['sourceSha256'].items():
    with open(os.path.join(BASE, filename), 'rb') as stream:
        assert hashlib.sha256(stream.read()).hexdigest() == expected, filename
assert len(snapshot['originalGlbSha256']) == 16, 'All sixteen original GLBs must be preserved.'
for filename, expected in snapshot['originalGlbSha256'].items():
    with open(os.path.join(BASE, 'public/models', filename), 'rb') as stream:
        assert hashlib.sha256(stream.read()).hexdigest() == expected, filename
assert json.loads(scene['original_glb_sha256']) == snapshot['originalGlbSha256']
assert json.loads(scene['source_sha256']) == snapshot['sourceSha256']
assert scene['scene_geometry_sha256'] == snapshot['sceneGeometrySha256']['detail']
assert scene['walking_review_events'] == json.dumps(review['events'])
report = {
    'passed': True,
    'frameCount': len(review['samples']),
    'fps': review['fps'],
    'durationSeconds': len(review['samples']) / review['fps'],
    'routeLengthEachWay': review['routeLength'],
    'speedUnitsPerSecond': review['speed'],
    'maximumPositionError': maximum_position_error,
    'maximumYawErrorRadians': maximum_yaw_error,
    'maximumHeadingStepRadians': maximum_heading_step,
    'headingSpeedLimitRadiansPerSecond': review['turnSpeedRadiansPerSecond'],
    'continuousHeadingMatchesController': True,
    'walkGaitRate': review['walkGaitRate'],
    'clipClockMatchesRuntimeRate': True,
    'originalGlbCount': len(snapshot['originalGlbSha256']),
    'originalGlbHashesMatch': True,
    'rootScaleConstant': [1, 1, 1],
    'rootScaleKeyframes': False,
    'visibilityMatchesController': True,
    'yawMatchesController': True,
    'sourceHashesMatch': True,
    'geometryHashMatches': True,
    'crossfadeSeconds': review['crossfadeSeconds'],
    'reviewDisclosure': review['disclosure'],
    'presentationPostprocess': 'Gentle ffmpeg hqdn3d=1:1:2:2 render grain reduction only.',
}
video = os.path.join(BASE, 'asset-renders/blender-corporate-natural-walking-lifecycle.mp4')
require_video = '--require-video' in sys.argv
assert not require_video or os.path.isfile(video), 'The complete encoded review is required.'
if os.path.isfile(video):
    probe = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,nb_read_frames,duration',
        '-of', 'json', video,
    ]))['streams'][0]
    assert int(probe['nb_read_frames']) == len(review['samples']), 'Incomplete encoded video.'
    assert float(Fraction(probe['avg_frame_rate'])) == review['fps']
    assert abs(float(probe['duration']) - review['duration']) < 0.001
    assert probe['width'] == scene.render.resolution_x * scene.render.resolution_percentage // 100
    assert probe['height'] == scene.render.resolution_y * scene.render.resolution_percentage // 100
    subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-i', video, '-f', 'null', '-'], check=True)
    report['video'] = {
        'filename': os.path.basename(video),
        'codec': probe['codec_name'],
        'width': probe['width'],
        'height': probe['height'],
        'decodedFrameCount': int(probe['nb_read_frames']),
        'fullDecodePassed': True,
        'sha256': hashlib.sha256(open(video, 'rb').read()).hexdigest(),
        'bytes': os.path.getsize(video),
    }
output = os.path.join(BASE, 'assets-source/corporate-walking-validation.json')
with open(output, 'w') as stream:
    json.dump(report, stream, indent=2)
    stream.write('\n')
print(json.dumps(report, indent=2))

"""Assemble the eight actual Blender closeups into one labeled review sheet.
Run after render_residents.py -- portraits 96. Requires Pillow, never changes GLBs.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json
B=Path(__file__).resolve().parent.parent
R=B/'asset-renders'
variants=json.loads((B/'assets-source/resident-variants.json').read_text())['variants']
prior=Image.open(R/'blender-resident-portraits.png').convert('RGB') if (R/'blender-resident-portraits.png').exists() else None
W,H=2400,1640
out=Image.new('RGB',(W,H),'#f0f0e9');draw=ImageDraw.Draw(out)
def font(size,bold=False):
 p=Path('/usr/share/fonts/truetype/dejavu/DejaVuSans'+('-Bold' if bold else '')+'.ttf')
 return ImageFont.truetype(str(p),size) if p.exists() else ImageFont.load_default()
draw.rectangle((0,0,W,100),fill='#25312f')
draw.text((38,20),'PI OFFICE / RESIDENT STUDIES',font=font(32,True),fill='#f4f2e9')
draw.text((40,64),'Eight original adult characters · authored geometry, hair, clothing and animation',font=font(18),fill='#c9d4c9')
for i,v in enumerate(variants):
 source=R/f"resident-portrait-{v['id']}.png"
 if source.exists():im=Image.open(source).convert('RGB')
 elif prior is not None:
  px=(i%4)*600;py=100+(i//4)*766;im=prior.crop((px,py,px+600,py+720))
 else:raise FileNotFoundError(source)
 im.thumbnail((600,720))
 x=(i%4)*600;y=100+(i//4)*766;out.paste(im,(x,y))
 draw.rectangle((x,y+720,x+600,y+766),fill='#e3e7dd')
 draw.text((x+20,y+732),f"{v['id']}  {v['label']}",font=font(17,True),fill='#25312f')
draw.text((35,1632),'',font=font(1),fill='#25312f')
p=R/'blender-resident-portraits.png';out.save(p,optimize=True);print(p)
# Individual renders are build intermediates; deliver only the composed review sheet.
for v in variants:(R/f"resident-portrait-{v['id']}.png").unlink(missing_ok=True)

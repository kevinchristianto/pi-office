"""Compose three unaltered exported-GLB proof renders; requires Pillow."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
B=Path(__file__).resolve().parent.parent;R=B/'asset-renders'
fontpath=Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
def font(size):return ImageFont.truetype(str(fontpath),size) if fontpath.exists() else ImageFont.load_default()
out=Image.new('RGB',(2700,890),'#edf0e7');d=ImageDraw.Draw(out)
d.rectangle((0,0,2700,80),fill='#26342f');d.text((30,19),'HAND ANATOMY / EXPORTED-MODEL CHECK',font=font(34),fill='#f1f3ea')
for i,(key,title,caption) in enumerate([('rest','REST','Thumbs toward the body; index fingers beside thumbs.'),('typing','TYPING','Palms down, knuckles up; thumbs toward keyboard midline.'),('wave','WAVING','Open palm faces outward; thumb stays on its radial side.')]):
 im=Image.open(R/f'hand-proof-{key}.png').convert('RGB');out.paste(im,(i*900,80));d.text((i*900+25,811),title,font=font(24),fill='#26342f');d.text((i*900+25,850),caption,font=font(19),fill='#26342f')
p=R/'blender-hand-anatomy-proof.png';out.save(p,optimize=True);print(p)
for key in ['rest','typing','wave']:(R/f'hand-proof-{key}.png').unlink()

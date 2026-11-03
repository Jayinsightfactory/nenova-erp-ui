import sys
from PIL import Image, ImageFilter
import numpy as np
from collections import deque
src,prefix=sys.argv[1],sys.argv[2]
im=Image.open(src).convert('RGB'); a=np.array(im).astype(int); H,W,_=a.shape
near=(a.min(axis=2)>232); bg=np.zeros((H,W),bool); q=deque()
for x in range(W): q+=[(0,x),(H-1,x)]
for y in range(H): q+=[(y,0),(y,W-1)]
while q:
    y,x=q.popleft()
    if y<0 or x<0 or y>=H or x>=W or bg[y,x] or not near[y,x]: continue
    bg[y,x]=True; q.extend(((y+1,x),(y-1,x),(y,x+1),(y,x-1)))
col=(~bg).sum(0); xs=[x for x in range(W) if col[x]>3]
segs=[];s=p=xs[0]
for x in xs[1:]:
    if x-p>6: segs.append((s,p)); s=x
    p=x
segs.append((s,p)); segs=[g for g in segs if g[1]-g[0]>40]; print(segs)
alpha=Image.fromarray(((~bg)*255).astype('uint8')).filter(ImageFilter.GaussianBlur(0.8))
rgba=im.copy(); rgba.putalpha(alpha); A=np.array(rgba)
for i,(x0,x1) in enumerate(segs):
    sub=A[:,max(0,x0-4):x1+5]; ys=np.where(sub[...,3].max(1)>10)[0]; sub=sub[ys[0]:ys[-1]+1]
    o=Image.fromarray(sub); pd=Image.new('RGBA',(o.width+16,o.height+16)); pd.paste(o,(8,8)); pd.save(f'{prefix}{i+1}.png')

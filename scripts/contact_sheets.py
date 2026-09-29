"""Identical labelled contact sheets for batch and streaming review."""
import json
import sys
from PIL import Image, ImageDraw

def render_sheet(s):
    tiles=[Image.open(t["file"]).convert("RGB") for t in s["tiles"]]
    w=max(im.width for im in tiles); h=max(im.height for im in tiles)
    sheet=Image.new("RGB",(w*2+30,h*2+30),(120,120,120))
    d=ImageDraw.Draw(sheet)
    for i,(im,t) in enumerate(zip(tiles,s["tiles"])):
        x=(i%2)*(w+10)+10; y=(i//2)*(h+10)+10
        sheet.paste(im,(x,y))
        label="page %d"%t["page"]
        d.rectangle([x,y,x+90,y+22],fill=(200,30,30)); d.text((x+6,y+5),label,fill=(255,255,255))
    sheet.save(s["out"],"PNG" if s["out"].endswith(".png") else "JPEG",quality=82)

if __name__ == '__main__':
    spec = json.load(sys.stdin)
    for sheet in spec:
        render_sheet(sheet)
    print(len(spec))

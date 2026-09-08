"""Orthographic 6×9 paperback, for the shared HTML cover face. No tilt or perspective.
Blender --background --python scripts/motion/render-overhead.py
The top cover occupies x=144..720, y=144..1008 in a 864×1152 transparent image.
"""
import bpy, math
from mathutils import Vector
from pathlib import Path
root=Path(__file__).resolve().parents[2]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=32;s.cycles.use_denoising=True
s.render.resolution_x=864;s.render.resolution_y=1152;s.render.resolution_percentage=100
s.render.image_settings.file_format='PNG';s.render.image_settings.color_mode='RGBA';s.render.film_transparent=True
s.world.color=(.5,.5,.5);s.view_settings.view_transform='Standard'
def mat(name,c,rough=.8):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=rough;return m
paper=mat('Ivory page edges',(.77,.73,.64));lightpaper=mat('Paper stratum',(.93,.89,.8));cover=mat('Matte printed cover',(.92,.90,.85))
def box(name,pos,size,material,bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
 if bevel:
  b=o.modifiers.new('Subtle edge radius','BEVEL');b.width=bevel;b.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
 return o
box('Back cover',(.015,-.025,.008),(6,9,.016),cover,.009)
box('Text block',(.035,-.035,.21),(5.93,8.93,.40),paper,.012)
for i in range(72):
 z=.023+i*.0053
 box('Foot leaf',(0,-4.508,z),(5.94,.005,.0018),lightpaper)
 box('Fore leaf',(3.001,-.035,z),(.005,8.94,.0018),lightpaper)
box('Front cover',(0,0,.425),(6,9,.022),cover,.007)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,0));floor=bpy.context.object;floor.is_shadow_catcher=True;floor.data.materials.append(mat('Desk',(.32,.2,.1)))
def area(name,pos,power,size):
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
area('Upper left window',(-6,8,12),1900,6);area('Room bounce',(4,-2,14),750,10)
bpy.ops.object.camera_add(location=(0,0,30));cam=bpy.context.object;cam.rotation_euler=(0,0,0);cam.data.type='ORTHO';cam.data.ortho_scale=12;s.camera=cam
# Camera looks down its local -Z; cover remains precisely parallel to the image plane.
out=root/'assets/motion/topdown-production/overhead-object.png';out.parent.mkdir(parents=True,exist_ok=True);s.render.filepath=str(out);bpy.ops.render.render(write_still=True)

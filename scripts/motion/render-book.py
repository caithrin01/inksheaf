"""Deterministic opening experiment. Run with Blender --background --python ... -- --draft.
The generated desk plate is the immutable background. Only one book and its shadow move.
"""
import bpy, math, sys, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
DRAFT='--draft' in args
MOBILE='--mobile' in args
OUT=ROOT/'assets/motion'/('portrait' if MOBILE else 'desktop');OUT.mkdir(exist_ok=True,parents=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene
scene.render.engine='CYCLES';scene.cycles.samples=24 if DRAFT else 48
scene.cycles.use_denoising=True
scene.render.use_persistent_data=True
if '--gpu' in args:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
    for device in prefs.devices:device.use=device.type=='METAL'
    scene.cycles.device='GPU'
scene.render.resolution_x=840 if MOBILE else (960 if DRAFT else 1600)
scene.render.resolution_y=1280 if MOBILE else (540 if DRAFT else 900)
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.render.film_transparent=True
scene.view_settings.view_transform='Standard';scene.view_settings.look='None'
scene.world.color=(.26,.22,.16)
# The background is already a photograph; Standard keeps its colours unaltered.
def material(name,color,rough=.6,noise=False):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    n=mat.node_tree.nodes;p=n.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough
    if noise:
        tex=n.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=180;tex.inputs['Detail'].default_value=2
        bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.06 if 'paper' in name.lower() else .18;bump.inputs['Distance'].default_value=.012
        mat.node_tree.links.new(tex.outputs['Fac'],bump.inputs['Height']);mat.node_tree.links.new(bump.outputs['Normal'],p.inputs['Normal'])
    return mat
cloth=material('Uncoated ivory cloth',(.84,.71,.50),.84,True)
paper=material('Warm ivory paper',(.94,.86,.72),.83,True)
edge=material('Page edges',(.68,.59,.43),.9)
ink=material('Walnut letterpress',(.13,.066,.027),.9)
rule=material('Oxblood rule',(.27,.063,.024),.75)
def cube(name,loc,scale,mat,bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat)
    if bevel:
        b=o.modifiers.new('Soft material edges','BEVEL');b.width=bevel;b.segments=3
        o.modifiers.new('Face normals','WEIGHTED_NORMAL')
    return o
# Right-hand volume stays in exactly one place, with the spine along x=0.
base=cube('Back board',(3,0,.075),(6.2,9.2,.10),cloth,.045)
block=cube('Text block',(3.02,0,.28),(5.95,8.98,.32),edge,.055)
# A curved top leaf gives a real gutter without gibberish text in the photo.
verts=[];faces=[];N=64
for i in range(N+1):
    x=.04+5.91*i/N;z=.49+.045*math.exp(-x*2)-.027*math.sin(math.pi*x/6)
    verts.extend([(x,-4.48,z),(x,4.48,z)])
    if i:faces.append(((i-1)*2,i*2,i*2+1,(i-1)*2+1))
mesh=bpy.data.meshes.new('Recto leaf');mesh.from_pydata(verts,[],faces);mesh.materials.append(paper)
for poly in mesh.polygons:poly.use_smooth=True
leaf=bpy.data.objects.new('Blank title page',mesh);bpy.context.collection.objects.link(leaf)
sol=leaf.modifiers.new('Paper thickness','SOLIDIFY');sol.thickness=.009
# Real page strata on the fore-edge and foot, fixed across every frame.
for i in range(25):
    z=.13+i*.012
    cube('Paper stratum',(3.04,-4.488,z),(5.87,.004,.004),paper,0)
    cube('Fore edge stratum',(5.991,0,z),(.004,8.88,.004),paper,0)
bpy.ops.object.empty_add(location=(0,0,.53));hinge=bpy.context.object;hinge.name='Cover hinge'
front=cube('Cloth cover',(3,0,0),(6.2,9.2,.075),cloth,.045);front.parent=hinge
lining=cube('Inside cover endpaper',(3,0,-.047),(5.94,8.96,.009),paper,.012);lining.parent=hinge
fontpath=ROOT/'assets/motion/EBGaramond.ttf'
font=bpy.data.fonts.load(str(fontpath)) if fontpath.exists() else None
def text(body,x,y,size,parent=hinge):
    c=bpy.data.curves.new('Cover type','FONT');c.body=body;c.align_x='CENTER';c.align_y='CENTER';c.size=size;c.space_line=1.05
    if font:c.font=font
    o=bpy.data.objects.new('Impressed cover title',c);bpy.context.collection.objects.link(o);o.location=(x,y,.046);o.data.materials.append(ink);o.parent=parent;return o
text('Your\nNewsletter',3,.4,1.0)
text('THE COLLECTED EDITION',3,-3.38,.16)
# Fine double rule is geometry, so it cannot drift across frames.
for inset,mat in [(.32,rule),(.39,ink)]:
    for x in [inset,6-inset]:
        o=cube('Cover vertical rule',(x,0,.046),(.012,9-2*inset,.004),mat,0);o.parent=hinge
    for y in [-4.5+inset,4.5-inset]:
        o=cube('Cover horizontal rule',(3,y,.046),(6-2*inset,.012,.004),mat,0);o.parent=hinge
# Warm broad lamp and quiet fill.
def area(name,loc,power,size,color):
    d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((1,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
area('Lamplight',(-5,3,9),900,7,(1,.83,.59));area('Room fill',(1,-4,10),750,10,(1,.94,.84))
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,0));floor=bpy.context.object;floor.name='Desk shadow catcher';floor.is_shadow_catcher=True
floor.data.materials.append(material('Walnut shadow surface',(.3,.18,.07),.7))
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera
# Desktop placement keeps the engraving below the left board. Portrait uses a more overhead
# crop of the desk, with the book in the upper half and the engraved mark below it.
if MOBILE:
    target=Vector((0,0,0));camera.location=(-.2,-2,30);camera.data.ortho_scale=16
else:
    target=Vector((0,0,0));camera.location=target+Vector((-3,-14,27));camera.data.ortho_scale=22
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO'
bpy.context.view_layer.update()
from bpy_extras.object_utils import world_to_camera_view
center=world_to_camera_view(scene,camera,Vector((3,0,.5)))
aspect=scene.render.resolution_x/scene.render.resolution_y
span_x=camera.data.ortho_scale*min(1,aspect);span_y=camera.data.ortho_scale/min(1,aspect)*min(1,aspect)/max(1,aspect)
desired=(.55,.57) if MOBILE else (.72,.53)
camera.location += camera.rotation_euler.to_matrix() @ Vector(((center.x-desired[0])*span_x,(center.y-desired[1])*span_y,0))
bpy.context.view_layer.update()
# Composite the real desk plate under the physically rendered book and its contact shadow.
scene.use_nodes=True;nodes=scene.node_tree.nodes;nodes.clear();links=scene.node_tree.links
photo=nodes.new('CompositorNodeImage');photo.image=bpy.data.images.load(str(ROOT/'assets/motion'/('desk-portrait-source.png' if MOBILE else 'desk-plate-source.png')))
scale=nodes.new('CompositorNodeScale');scale.space='RENDER_SIZE';scale.frame_method='STRETCH';links.new(photo.outputs['Image'],scale.inputs['Image'])
render=nodes.new('CompositorNodeRLayers');over=nodes.new('CompositorNodeAlphaOver');over.inputs[0].default_value=1
plate=scale.outputs['Image']
if MOBILE:
    framing=nodes.new('CompositorNodeTransform');framing.inputs['Scale'].default_value=1.16;framing.inputs['Y'].default_value=-70;framing.inputs['X'].default_value=75
    links.new(plate,framing.inputs['Image']);plate=framing.outputs['Image']
links.new(plate,over.inputs[1]);links.new(render.outputs['Image'],over.inputs[2])
output=nodes.new('CompositorNodeComposite');links.new(over.outputs['Image'],output.inputs['Image'])
# Right-page corners are exported to align real HTML type and form with the final image.
bpy.context.view_layer.update()
from bpy_extras.object_utils import world_to_camera_view
corners=[]
for v in [(.3,4.2,.51),(5.7,4.2,.51),(5.7,-4.2,.51),(.3,-4.2,.51)]:
    c=world_to_camera_view(scene,camera,Vector(v));corners.append([c.x,1-c.y])
(OUT/'page.json').write_text(json.dumps({'size':[scene.render.resolution_x,scene.render.resolution_y],'corners':corners},indent=2))
phases=[0,.5,1] if DRAFT else [i/23 for i in range(24)]
items=list(enumerate(phases))
if not DRAFT:items=[items[0],items[-1],*items[1:-1]]
for i,p in items:
    if '--resume' in args and (OUT/f'frame-{i:02}.png').exists():continue
    p=p*p*(3-2*p)
    hinge.rotation_euler.y=-math.pi*p;hinge.location.z=.53-.39*(p**6)
    scene.render.filepath=str(OUT/f'frame-{i:02}.png');bpy.ops.render.render(write_still=True)
print('MOTION RENDERS COMPLETE',OUT)

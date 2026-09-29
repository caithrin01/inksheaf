import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {emitTypst} from './lib/typst-emit.mjs';
import {figureReadingSizes} from './lib/figure-reading.mjs';
import {queryMetadata} from './typst-metadata.mjs';

// Exercise the printed PDF, including fallback layouts and the position packet
// used by source-order / whitespace review. No model calls or cached book needed.
const out = resolve('proofs/fixtures/figure-openings');
mkdirSync(out, {recursive: true});
execFileSync('python3', ['-c', `from PIL import Image,ImageDraw
for name,w,h in [('chart',3000,1600),('small',800,400),('portrait',1000,1600)]:
 im=Image.new('RGB',(w,h),'white');d=ImageDraw.Draw(im)
 d.rectangle((1,1,w-2,h-2),outline='black',width=2)
 d.text((30,30),'UNCHANGED SOURCE LABEL 1234567890',fill='black')
 im.save('${out}/'+name+'.png')
`]);
const cases = [
  {id: 'first', opening: true},
  {id: 'reference', opening: true, sub: '', backLinks: true},
  {id: 'plain', noImage: true},
  {id: 'prose', before: 'BeforeMarker. This prose must precede the source chart.'},
  {id: 'caption', caption: 'CaptionMarker. This caption must remain with the chart.'},
  {id: 'long', sub: 'This deliberately long subtitle must fall back to an ordinary article heading without changing the reading size of the chart. '.repeat(4)},
  {id: 'compact', compact: true},
  {id: 'column', mode: 'column'},
  {id: 'portrait', mode: 'column', image: 'portrait'},
  {id: 'small', image: 'small'},
  {id: 'details', details: true},
  {id: 'ordinary', mode: 'normal'},
  {id: 'floating', mode: 'normal', extraImage: true},
  {id: 'fitted', mode: 'normal', fitHeight: 1.2},
  {id: 'picture', mode: 'normal', picture: true},
  {id: 'image-only', opening: true, noProse: true},
  {id: 'unnumbered', opening: true, number: false, sub: '', meta: ''},
  {id: 'last-image-only', opening: true, noProse: true},
];
const readingFigures = {}, sourceFigureRoles = {}, fitText = {}, fitFigs = {}, backLinks = [];
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const chart = resolve(out, 'chart.png');
const articles = cases.map((c, i) => {
  c.n = i + 1;
  c.title = `Opening ${c.id}`;
  c.sub ??= 'A readable chart at its original scale';
  c.meta ??= 'September 22, 2026';
  c.body = c.noProse ? '' : `AfterMarker${c.n}. The complete source text remains after its illustration.`;
  if (c.mode !== 'normal') readingFigures[c.id] = c.mode || 'landscape';
  if (c.fitHeight) fitFigs[c.id] = c.fitHeight;
  if (c.picture) sourceFigureRoles[c.id] = {role: 'picture', image_sha256: digest(chart)};
  if (c.compact) fitText[c.n] = .54;
  if (c.backLinks) backLinks.push(c.n);
  if (c.details) sourceFigureRoles[c.id] = {
    role: 'reading', reading_detail: 'small_text', image_sha256: digest(chart),
    grid: {rows: 1, columns: 2},
    detail_panels: [{source: chart, image_sha256: digest(chart), index: 1, row: 1, first_column: 1, last_column: 2}],
  };
  return `<section class="article"><div class="arthead">${c.number === false ? '' : `<div class="artnum">${c.n}</div>`}<h2 class="arttitle">${c.title}</h2><div class="artsub">${c.sub}</div><div class="artmeta">${c.meta}</div></div><div class="artbody">${c.before ? `<p>${c.before}</p>` : ''}${c.noImage ? '' : `<figure><img src="${c.image || 'chart'}.png" data-fig="${c.id}" alt="chart">${c.caption ? `<figcaption>${c.caption}</figcaption>` : ''}</figure>`}<p>${c.body}</p>${c.extraImage ? `<figure><img src="chart.png" data-fig="${c.id}-last" alt="chart"></figure>` : ''}</div>${c.backLinks ? '<div class="linknote"><p>ReferenceMarker. Original source.</p></div>' : ''}</section>`;
});
const typ = resolve(out, 'openings.typ'), pdf = resolve(out, 'openings.pdf');
writeFileSync(typ, emitTypst(`<html><body><section class="titlepage"><div class="t">Opening controls</div></section>${articles.join('')}</body></html>`, {baseDir: out, readingFigures, sourceFigureRoles, fitText, fitFigs, backLinks}));
execFileSync('typst', ['compile', '--font-path', 'fonts', '--ignore-system-fonts', typ, pdf]);
const metadata = queryMetadata(typ);
const headings = JSON.parse(execFileSync('typst', ['query', '--font-path', 'fonts', '--ignore-system-fonts', typ, 'heading.where(level: 1)'], {encoding: 'utf8'}));
assert.equal(headings.length, cases.length, 'contents heading appears exactly once per article');
assert.equal(metadata.artstart.length, cases.length);
assert.equal(metadata.artend.length, cases.length);
assert.equal(metadata.fig.length, cases.filter(c => !c.noImage).length + 2, 'overview, detail and extra floating control appear exactly once');
for (const c of cases) {
  const start = metadata.artstart.find(a => a.n === c.n);
  assert.equal(Boolean(start.opening), Boolean(c.opening), `${c.id}: measured opening/fallback`);
  const f = metadata.fig.find(f => f.id === c.id);
  if (c.noImage) { assert.equal(f, undefined); continue; }
  const dim = c.image === 'small' ? {w: 800, h: 400} : c.image === 'portrait' ? {w: 1000, h: 1600} : {w: 3000, h: 1600};
  const expected = figureReadingSizes(dim).find(s => s.mode === (c.mode || 'landscape'));
  if (expected) for (const [actual, wanted] of [[f.w, expected.width_points], [f.h, expected.height_points], [f.image_width_points, expected.image_width_points]]) assert(Math.abs(actual - wanted) < .01, `${c.id}: reading dimensions unchanged`);
  if (c.opening) assert.equal(f.page, start.page, `${c.id}: title and image share their leaf`);
  if (c.noProse) assert.equal(metadata.artend.find(a => a.n === c.n).page, start.page, `${c.id}: no phantom final leaf`);
  if (c.id === 'long') assert(f.page > start.page, 'oversized heading safely falls back');
  assert.equal(f.floating, Boolean(c.extraImage));
}
assert.equal(metadata.folio.find(f => f.page === metadata.artstart[0].page).folio, 1);
writeFileSync(resolve(out, 'expected.json'), JSON.stringify({cases, metadata}));
const result = execFileSync('python3', ['-c', `import json,re,unicodedata
from pathlib import Path
import pymupdf as fitz
p=Path(${JSON.stringify(out)});expected=json.loads((p/'expected.json').read_text());m=expected['metadata'];doc=fitz.open(p/'openings.pdf')
norm=lambda s: re.sub(r'\\s+', '', unicodedata.normalize('NFKC',s).replace('\\u00ad',''))
used=set()
for f in m['fig']:
 source=fitz.Pixmap(f['source']).digest
 matches=[(i,im) for i,im in enumerate(doc[f['page']-1].get_image_info(hashes=True)) if im['digest']==source and (f['page'],i) not in used]
 assert matches,(f['id'],'missing source image on the recorded page')
 i,im=min(matches,key=lambda pair:abs(pair[1]['bbox'][1]-f['y']));r=fitz.Rect(im['bbox']);used.add((f['page'],i))
 for a,b in [(r.y0,f['y']),(r.width,f['w']),(r.height,f['h'])]: assert abs(a-b)<.02,(f['id'],'figure metadata differs from print',a,b)
for c in expected['cases']:
 start=next(a for a in m['artstart'] if a['n']==c['n']);end=next(a for a in m['artend'] if a['n']==c['n'])
 body=''.join(page.get_text(clip=fitz.Rect(0,40,432,604)) for page in list(doc)[start['page']-1:end['page']])
 for part in [c['title'],c['sub'],c['meta'].upper(),c['body'],c.get('before',''),c.get('caption','')]:
  if part: assert norm(body).count(norm(part))==1,(c['id'],'source text lost or duplicated',part)
 if c.get('opening'):
  page=doc[start['page']-1];text=norm(page.get_text())
  assert norm(c['title']) in text
  assert not c['body'] or norm(c['body']) not in text,(c['id'],'portrait prose leaks onto the landscape opening')
  if c.get('number',True): assert norm(str(c['n'])+' · '+c['meta'].upper()) in text,(c['id'],'article number lost')
  f=next(f for f in m['fig'] if f['id']==c['id']);images=page.get_image_info(hashes=True)
  assert len(images)==1,(c['id'],'wrong image count')
  r=fitz.Rect(images[0]['bbox'])
  for a,b in [(r.y0,f['y']),(r.width,f['w']),(r.height,f['h'])]: assert abs(a-b)<.02,(c['id'],'figure metadata differs from print',a,b)
  assert images[0]['digest']==fitz.Pixmap(str(p/'chart.png')).digest,(c['id'],'source pixels changed')
  heading_rects=[fitz.Rect(line['bbox']) for b in page.get_text('dict')['blocks'] if b['type']==0 for line in b['lines'] if line['dir']!=(1.0,0.0)]
  assert heading_rects and all(r.x1 < h.x0 and h.y0>=40 and h.y1<=604 for h in heading_rects),(c['id'],'heading overlaps image or running matter')
 if c.get('backLinks'):
  assert re.search(r'LINKSONPAGE[0-9]+',norm(body)), 'resolved back-reference missing from landscape heading'
print('PASS printed source content, figure scale/pixels, heading separation, folios and measured image positions')
print('PASS every figure records its actual printed page/top/size: ordinary, floated, fitted, picture, column, landscape and detail')
`], {encoding: 'utf8'});
console.log(result.trim());
execFileSync('python3', ['scripts/pdf-bounds-audit.py', pdf, '--out', resolve(out, 'bounds.json')], {stdio: 'pipe'});
console.log(`PASS ${cases.length} compiled opening/fallback controls; all glyphs and images within paper`);

// Independent page-quality review, used after every live delivery and by the live-book test. A different, stronger model than
// the press's own reviewers reads sampled pages of the delivered PDF as a print production
// editor would. It never changes the book; it only reports what a reader would notice.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const QUALITY_MODEL = 'anthropic/claude-opus-5.5';
export const TASK = `You are the production editor at a book publisher, checking one page of a print-ready 6 x 9 inch paperback made from a writer's newsletter.
The first image is the target page. Adjacent pages, when supplied, are context only: report defects on the target, not its neighbours. Check the following page before judging a short page: a protected-size figure can explain the break. Landscape figures are intentionally rotated so the reader turns the book; rotation alone is not a defect. An overview followed by labelled enlarged details is intentional, not duplication. These conventions never excuse unreadable lettering, clipped content, or actual overlap.
Report only what a careful reader of the printed page would notice. Emoji drawn as small black-and-white pictograms are intended, as is an author's own wording and punctuation. Defect types:
- cut_off: text or images cut off at an edge, or overlapping each other
- unreadable: lettering in a chart, table or screenshot too small to read in print
- broken_image: a missing image, a placeholder box, or an image that failed to render
- junk: raw HTML, markdown, code, stray URLs or button text that should not print
- mojibake: garbled characters or missing glyphs (boxes, question marks)
- bad_break: a heading alone at the bottom of a page, a single stranded line, or a page that ends far too early for no reason
- duplicate: the same text or image printed twice
- running_matter: a wrong or missing running head or page number
- other: anything else a reader would call a mistake
Severity: "major" if a reader would call the book broken or unprofessional on this page; "minor" if it is a blemish.
Answer with JSON only: {"verdict":"good"|"minor"|"major","defects":[{"type":"...","severity":"major"|"minor","note":"under 160 characters"}]}`;

export function samplePages(total) {
  const pick = new Set([1, 2, 3, 4, total - 1, total].filter(p => p >= 1 && p <= total));
  for (let i = 1; i <= 10; i++) pick.add(Math.max(1, Math.min(total, Math.round(i * total / 11))));
  return [...pick].sort((a, b) => a - b);
}

export async function reviewQuality(pdf, {outDir, key, fetchImpl = fetch, model = QUALITY_MODEL, pages = null} = {}) {
  mkdirSync(outDir, {recursive: true});
  const total = Number(execFileSync('python3', ['-c', 'import sys,pymupdf;print(len(pymupdf.open(sys.argv[1])))', pdf], {encoding: 'utf8'}).trim());
  const sample = pages || samplePages(total), results = [];
  for (const page of sample) {
    const base = join(outDir, `q-${String(page).padStart(4, '0')}`);
    execFileSync('pdftoppm', ['-png', '-r', '150', '-f', String(page), '-l', String(page), '-singlefile', pdf, base]);
    const images=[{type:'image_url',image_url:{url:`data:image/png;base64,${readFileSync(base+'.png').toString('base64')}`}}];
    for(const adjacent of [page-1,page+1].filter(p=>p>=1&&p<=total)){
      const context=join(outDir,`context-${adjacent}`);
      execFileSync('pdftoppm',['-png','-r','100','-f',String(adjacent),'-l',String(adjacent),'-singlefile',pdf,context]);
      images.push({type:'text',text:`Context only: physical page ${adjacent}.`},{type:'image_url',image_url:{url:`data:image/png;base64,${readFileSync(context+'.png').toString('base64')}`}});
    }
    let answer = null, error = null, usage = null;
    for (let attempt = 0; attempt < 2 && !answer; attempt++) {
      try {
        const r = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {method: 'POST', signal: AbortSignal.timeout(120000),
          headers: {authorization: `Bearer ${key}`, 'content-type': 'application/json'},
          body: JSON.stringify({model, max_tokens: 900, temperature: 0, messages: [{role: 'user', content: [
            {type: 'text', text: `${TASK}\nThis is physical page ${page} of ${total}.`},
            ...images]}]})});
        const j = await r.json();
        if (!r.ok) throw Error(`HTTP ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
        usage = j.usage || null;
        const text = String(j.choices?.[0]?.message?.content || '');
        const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        if (!['good', 'minor', 'major'].includes(parsed.verdict) || !Array.isArray(parsed.defects)) throw Error('Unusable review answer');
        answer = parsed;
      } catch (e) { error = String(e.message).slice(0, 200); }
    }
    results.push({page, ...(answer || {verdict: 'unreviewed', defects: [], error}), usage});
  }
  const cost = results.reduce((t, r) => t + (Number(r.usage?.cost) || 0), 0);
  const summary = {model, pages_total: total, pages_reviewed: results.length,
    major: results.filter(r => r.verdict === 'major').map(r => r.page), minor: results.filter(r => r.verdict === 'minor').map(r => r.page),
    unreviewed: results.filter(r => r.verdict === 'unreviewed').map(r => r.page), cost_usd: Math.round(cost * 1e6) / 1e6, results};
  writeFileSync(join(outDir, 'quality.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

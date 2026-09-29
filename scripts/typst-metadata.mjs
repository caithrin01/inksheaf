// One layout evaluation supplies the page maps. Query and compile use the
// same repository-only font set, so measurements describe the rendered PDF.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

export const METADATA_LABELS = ['artstart', 'artend', 'partstart', 'publisher-page', 'folio', 'fig', 'linkstart', 'parstart', 'parend', 'print-element'];
export function queryMetadata(typ, { root = resolve(dirname(fileURLToPath(import.meta.url)), '..') } = {}) {
  const selector = `selector(<${METADATA_LABELS[0]}>).or(${METADATA_LABELS.slice(1).map(name => `<${name}>`).join(', ')})`;
  const rows = JSON.parse(execFileSync('typst', ['query', '--root', root, '--font-path', resolve(root, 'fonts'), '--ignore-system-fonts', typ, selector], { encoding: 'utf8', maxBuffer: 40_000_000, stdio: ['ignore', 'pipe', 'pipe'] }));
  if (!Array.isArray(rows)) throw Error('Typst metadata is not an array');
  const metadata = Object.fromEntries(METADATA_LABELS.map(name => [name, []]));
  for (const row of rows) {
    const label = METADATA_LABELS.find(name => row.label === `<${name}>`);
    if (!label || !Object.hasOwn(row, 'value')) throw Error('Typst returned an unexpected metadata element');
    metadata[label].push(row.value);
  }
  return metadata;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [typ, output] = process.argv.slice(2);
  if (!typ || !output) throw Error('Usage: typst-metadata.mjs input.typ output.json');
  writeFileSync(output, JSON.stringify(queryMetadata(typ)));
}

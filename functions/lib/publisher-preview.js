export const PREVIEW_MAX_BYTES=10_000_000;
export function previewURL(value){
  try{const u=new URL(value);return u.origin==='https://caithrin--inksheaf-proof-store-web.modal.run'&&u.pathname==='/proof'&&!u.username&&!u.password&&/^[a-f0-9]{64}$/.test(u.searchParams.get('sig')||'')&&/^proofs\/[a-zA-Z0-9._-]+\/p-[a-f0-9]{12}\.pdf$/.test(u.searchParams.get('key')||'')&&Number.isSafeInteger(Number(u.searchParams.get('exp')))?u:null;}catch{return null;}
}
export function validPreview(e){
  return e?.draft===true&&Number.isSafeInteger(e.round)&&e.round>=0&&e.round<=2&&/^[1-9][0-9]{0,2}$/.test(e.volume)&&Number.isSafeInteger(e.total_pages)&&e.total_pages>0&&e.total_pages<=10000&&/^[a-f0-9]{64}$/.test(e.sha256)&&/^[a-f0-9]{64}$/.test(e.source_sha256)&&Array.isArray(e.pages)&&e.pages.length>0&&e.pages.length<=6&&new Set(e.pages.map(p=>p.number)).size===e.pages.length&&e.pages.every(p=>Number.isSafeInteger(p.number)&&p.number>=1&&p.number<=e.total_pages&&typeof p.label==='string'&&p.label.length<=80&&['prose','lines',undefined].includes(p.text_mode))&&Boolean(previewURL(e.file_url));
}

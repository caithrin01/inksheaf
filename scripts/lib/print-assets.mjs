import { readFileSync } from 'node:fs';
export function printFonts() {
  return ['public/fonts/book.css','public/fonts/eb-garamond.css'].map(file=>readFileSync(file,'utf8').replace(/url\((?:['"])?([^)'"\s]+)(?:['"])?\)/g,(all,url)=>{
    const path=url.startsWith('/fonts/')?'public'+url:url.startsWith('./')?'public/fonts/'+url.slice(2):null;
    if(!path)return all;
    const ext=path.endsWith('.woff2')?'woff2':'ttf';
    return `url(data:font/${ext};base64,${readFileSync(path).toString('base64')})`;
  })).join('\n');
}

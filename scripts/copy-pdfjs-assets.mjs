// Keep PDF fonts/decoders on our origin: private reading never contacts a CDN.
import {cpSync,mkdirSync,copyFileSync} from 'node:fs';
mkdirSync('dist/pdfjs',{recursive:true});
for(const name of ['cmaps','standard_fonts','wasm'])cpSync(`node_modules/pdfjs-dist/${name}`,`dist/pdfjs/${name}`,{recursive:true});
copyFileSync('node_modules/pdfjs-dist/LICENSE','dist/pdfjs/LICENSE');

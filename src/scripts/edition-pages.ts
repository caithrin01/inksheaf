// Load PDF.js only when the reader asks for pages. One private document/worker and
// one render at a time; changing selection cancels and discards the prior draft.
import {pdfPageText} from '../lib/pdf-page-text.js';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
type Snapshot={volume:string;round:number;sequence:number;selection_revision?:number;url:string;sha256:string;pages:{number:number;label:string;text_mode?:string}[]};
export function editionPages(){
  const $=(id:string)=>document.getElementById(id)!;
  const button=(id:string)=>$(id) as HTMLButtonElement;
  let snapshots=new Map<string,Snapshot>(),volume='',index=0,active=false,complete=false,textView=false,serial=0,doc:any=null,loading:any=null,render:any=null,key='',resizer:ReturnType<typeof setTimeout>;
  const status=(text:string)=>{if($('draft-status').textContent!==text)$('draft-status').textContent=text;};
  function controls(){
    const e=snapshots.get(volume),count=e?.pages.length||0;
    button('draft-prev').disabled=!count||index===0;button('draft-next').disabled=!count||index>=count-1;
    $('draft-position').replaceChildren();if(e){for(const [text,className] of [[e.pages[index].label,'printed-label'],[`Preview ${index+1} of ${count}`,'preview-position']]){const span=document.createElement('span');span.textContent=text;span.className=className;$('draft-position').append(span);}}
    $('draft-changes').hidden=!e?.round;
    $('draft-paper').hidden=textView;$('draft-prose').hidden=!textView;
    button('draft-print').setAttribute('aria-pressed',String(!textView));button('draft-text').setAttribute('aria-pressed',String(textView));
    $('draft-volume-label').hidden=snapshots.size<2;
  }
  function discard(){
    serial++;render?.cancel();render=null;
    if(loading)loading.destroy().catch(()=>{});else if(doc)doc.destroy().catch(()=>{});
    loading=null;doc=null;key='';
    delete $('draft-surface').dataset.rendered;$('draft-paper').replaceChildren();$('draft-prose').replaceChildren();$('draft-surface').setAttribute('aria-busy','false');
  }
  async function show(){
    const e=snapshots.get(volume);if(!active||!e)return;
    const turn=++serial,pageIndex=index;
    render?.cancel();render=null;$('draft-retry').hidden=true;
    $('draft-surface').setAttribute('aria-busy','true');status('Opening your typeset page…');controls();
    // Clear the old leaf immediately: its old words must never wear a new label.
    $('draft-paper').replaceChildren();$('draft-prose').replaceChildren();
    try{
      const nextKey=e.sha256+e.url;
      if(key!==nextKey){
        if(loading)await loading.destroy();else if(doc)await doc.destroy();
        loading=null;doc=null;key='';
        const pdfjs=await import('pdfjs-dist/build/pdf.mjs');if(turn!==serial)return;
        pdfjs.GlobalWorkerOptions.workerSrc=workerURL;
        loading=pdfjs.getDocument({url:e.url,disableRange:true,disableStream:true,disableAutoFetch:true,isEvalSupported:false,useSystemFonts:false,cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'});
        const loaded=await loading.promise;if(turn!==serial){await loaded.destroy();return;}doc=loaded;key=nextKey;
      }
      if(turn!==serial)return;
      const page=await doc.getPage(pageIndex+1);if(turn!==serial)return;
      const content=await page.getTextContent();if(turn!==serial)return;
      const paragraphs=pdfPageText(content.items,{reflow:e.pages[pageIndex].text_mode==='prose'});
      if(paragraphs.length){$('draft-prose').replaceChildren(...paragraphs.map(part=>{const p=document.createElement('p');p.textContent=part.text;p.style.whiteSpace=part.lines?'pre-line':'normal';return p;}));}
      else{$('draft-prose').textContent='This page contains artwork or an image, with no extractable text. Switch to Printed page to see it.';}
      // Keep the visible paper crisp, bounded to a phone-safe raster size.
      if(!textView){
        const width=Math.max(180,$('draft-surface').clientWidth-(innerWidth<=640?24:40));
        const base=page.getViewport({scale:1}),scale=Math.min(2,devicePixelRatio||1)*width/base.width;
        const viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${e.pages[pageIndex].label}, as typeset. Use Read as text for the writing.`);
        render=page.render({canvasContext:canvas.getContext('2d'),viewport});await render.promise;if(turn!==serial)return;
        $('draft-paper').replaceChildren(canvas);$('draft-paper').style.aspectRatio=String(base.width/base.height);
      }
      status(complete?'The complete PDF is ready beside your cover. These are earlier preview pages.':e.round?'These pages include the latest layout adjustments. Checks continue.':'Typeset draft · Layout checks continue. We’ll email your complete PDF.');
      $('draft-surface').dataset.rendered=e.sha256;controls();
    }catch(error){
      if(turn!==serial)return;
      key='';status('These pages could not be opened just now. Your book is still saved.');$('draft-retry').hidden=false;
    }finally{if(turn===serial)$('draft-surface').setAttribute('aria-busy','false');}
  }
  button('draft-prev').onclick=()=>{if(index>0){index--;show();}};
  button('draft-next').onclick=()=>{if(index<(snapshots.get(volume)?.pages.length||0)-1){index++;show();}};
  button('draft-print').onclick=()=>{textView=false;show();};button('draft-text').onclick=()=>{textView=true;show();};
  button('draft-retry').onclick=()=>show();
  ($('draft-volume') as HTMLSelectElement).onchange=event=>{volume=(event.target as HTMLSelectElement).value;index=Math.max(0,snapshots.get(volume)!.pages.findIndex(p=>p.text_mode==='prose'||p.label.startsWith('Page ')));show();};
  window.addEventListener('resize',()=>{clearTimeout(resizer);resizer=setTimeout(()=>{if(active&&!textView)show();},180);});
  window.addEventListener('pagehide',()=>discard());
  return {
    complete(value:boolean){complete=value;document.querySelector('.pages-intro')!.textContent=value?'These are earlier pages from the making of your book. Open the complete PDF for the finished edition.':'A first look at your typeset book.';if(value)status('The complete PDF is ready beside your cover. These are earlier preview pages.');},
    reset(){discard();snapshots.clear();volume='';index=0;$('draft-volume').replaceChildren();controls();status('');},
    set(e:Snapshot){
      if(!Array.isArray(e.pages)||!e.pages.length)return;
      const url=new URL(e.url,location.origin);if(url.origin!==location.origin||url.pathname!=='/api/edition-pages')return;
      const prior=snapshots.get(e.volume);if(prior&&prior.sequence>=e.sequence)return;
      snapshots.set(e.volume,e);if(!volume){volume=e.volume;index=Math.max(0,e.pages.findIndex(p=>p.text_mode==='prose'||p.label.startsWith('Page ')));}
      const select=$('draft-volume') as HTMLSelectElement;select.replaceChildren(...[...snapshots.keys()].map(value=>{const option=document.createElement('option');option.value=value;option.textContent='Volume '+value;return option;}));select.value=volume;
      if(e.volume===volume){index=Math.min(index,e.pages.length-1);controls();show();}
    },
    activate(value:boolean){active=value;if(active)show();else{serial++;render?.cancel();$('draft-surface').setAttribute('aria-busy','false');}},
  };
}

// Load PDF.js only when the reader asks for pages. One private document/worker and
// one render at a time; changing selection cancels and discards the prior draft.
import {pdfPageText} from '../lib/pdf-page-text.js';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
type Snapshot={volume:string;label?:string;round:number;sequence:number;selection_revision?:number;complete?:boolean;version_id?:number;expires_at?:number;url:string;sha256:string;pages:{number:number;label:string;text_mode?:string}[]};
export function editionPages(){
  const $=(id:string)=>document.getElementById(id)!;
  const button=(id:string)=>$(id) as HTMLButtonElement;
  let snapshots=new Map<string,Snapshot>(),volume='',index=0,active=false,complete=false,textView=false,serial=0,doc:any=null,loading:any=null,render:any=null,key='',resizer:ReturnType<typeof setTimeout>;
  let download:AbortController|null=null,finishedKey='';
  const status=(text:string)=>{if($('draft-status').textContent!==text)$('draft-status').textContent=text;};
  function controls(){
    const e=snapshots.get(volume),count=e?.pages.length||0;
    button('draft-prev').disabled=!count||index===0;button('draft-next').disabled=!count||index>=count-1;
    $('draft-position').replaceChildren();if(e){for(const [text,className] of [[e.pages[index].label,'printed-label'],[`${e.complete?'Leaf':'Preview'} ${index+1} of ${count}`,'preview-position']]){const span=document.createElement('span');span.textContent=text;span.className=className;$('draft-position').append(span);}}
    button('draft-prev').setAttribute('aria-label',e?.complete?'Previous page':'Previous preview page');button('draft-next').setAttribute('aria-label',e?.complete?'Next page':'Next preview page');
    $('draft-jump-label').hidden=!e?.complete;($('draft-jump') as HTMLSelectElement).value=String(index);
    $('draft-changes').hidden=!e?.round;
    $('draft-paper').hidden=textView;$('draft-prose').hidden=!textView;
    button('draft-print').setAttribute('aria-pressed',String(!textView));button('draft-text').setAttribute('aria-pressed',String(textView));
    $('draft-volume-label').hidden=snapshots.size<2;
  }
  function discard(){
    serial++;download?.abort();download=null;render?.cancel();render=null;
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
        download?.abort();download=null;
        if(loading)await loading.destroy();else if(doc)await doc.destroy();
        loading=null;doc=null;key='';
        const pdfjs=await import('pdfjs-dist/build/pdf.mjs');if(turn!==serial)return;
        pdfjs.GlobalWorkerOptions.workerSrc=workerURL;
        let source:{url:string}|{data:Uint8Array}={url:e.url};
        if(e.complete){
          if((e.expires_at||0)<=Date.now())throw Error('Expired PDF');
          const controller=new AbortController();download=controller;const timeout=setTimeout(()=>controller.abort(),120000);
          try{
            const response=await fetch(e.url,{signal:controller.signal,cache:'no-store'});
            if(!response.ok||!response.headers.get('content-type')?.startsWith('application/pdf'))throw Error('PDF unavailable');
            const data=new Uint8Array(await response.arrayBuffer());if(turn!==serial)return;
            if(data.length>150_000_000)throw Error('PDF too large');
            const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
            if(turn!==serial)return;if(hash!==e.sha256)throw Error('PDF changed');source={data};
          }finally{clearTimeout(timeout);if(download===controller)download=null;}
        }
        if(turn!==serial)return;
        loading=pdfjs.getDocument({...source,disableRange:true,disableStream:true,disableAutoFetch:true,isEvalSupported:false,useSystemFonts:false,cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'});
        const loaded=await loading.promise;if(turn!==serial){await loaded.destroy();return;}doc=loaded;key=nextKey;
        if(doc.numPages!==e.pages.length){await doc.destroy();doc=null;key='';throw Error('Page count changed');}
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
      status(e.complete?'Your complete volume. Every page is available here.':complete?'The complete PDF is ready beside your cover. These are earlier preview pages.':e.round?'These pages include the latest layout adjustments. Checks continue.':'Typeset draft · Layout checks continue. We’ll email your complete PDF.');
      $('draft-surface').dataset.rendered=e.sha256;controls();
    }catch(error){
      if(turn!==serial)return;
      key='';status(e.complete&&(e.expires_at||0)<=Date.now()?'This private PDF link has expired. Your edition is saved; contact us to recover the file.':'These pages could not be opened just now. Your book is still saved.');$('draft-retry').hidden=false;
    }finally{if(turn===serial)$('draft-surface').setAttribute('aria-busy','false');}
  }
  button('draft-prev').onclick=()=>{if(index>0){index--;show();}};
  button('draft-next').onclick=()=>{if(index<(snapshots.get(volume)?.pages.length||0)-1){index++;show();}};
  button('draft-print').onclick=()=>{textView=false;show();};button('draft-text').onclick=()=>{textView=true;show();};
  button('draft-retry').onclick=()=>show();
  function navigation(){
    const select=$('draft-volume') as HTMLSelectElement;select.replaceChildren(...[...snapshots].map(([value,e])=>{const option=document.createElement('option');option.value=value;option.textContent=e.label||'Volume '+value;return option;}));select.value=volume;
    const pages=snapshots.get(volume)?.pages||[];($('draft-jump') as HTMLSelectElement).replaceChildren(...pages.map((p,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=`${p.label} · leaf ${p.number}`;return option;}));
  }
  ($('draft-jump') as HTMLSelectElement).onchange=event=>{const next=Number((event.target as HTMLSelectElement).value);if(Number.isSafeInteger(next)&&next>=0&&next<(snapshots.get(volume)?.pages.length||0)){index=next;show();}};
  ($('draft-volume') as HTMLSelectElement).onchange=event=>{volume=(event.target as HTMLSelectElement).value;index=Math.max(0,snapshots.get(volume)!.pages.findIndex(p=>p.text_mode==='prose'||p.label.startsWith('Page ')));navigation();show();};
  window.addEventListener('resize',()=>{clearTimeout(resizer);resizer=setTimeout(()=>{if(active&&!textView)show();},180);});
  window.addEventListener('pagehide',()=>discard());
  return {
    complete(value:boolean){complete=value;document.querySelector('.pages-intro')!.textContent=finishedKey?'Your finished book, from the first leaf to the last.':value?'These are earlier pages from the making of your book. Open the complete PDF for the finished edition.':'A first look at your typeset book.';if(value&&!finishedKey)status('The complete PDF is ready beside your cover. These are earlier preview pages.');},
    reset(){discard();snapshots.clear();volume='';index=0;finishedKey='';complete=false;navigation();controls();status('');},
    finish(values:Snapshot[]){
      if(!values?.length||values.some(e=>!e.complete||!e.pages?.length||new URL(e.url,location.origin).origin!==location.origin||new URL(e.url,location.origin).pathname!=='/api/edition-file'))return;
      const identity=values.map(e=>e.version_id+e.sha256+e.url).join('|');if(identity===finishedKey)return;
      const leaf=snapshots.get(volume)?.pages[index]?.number;discard();finishedKey=identity;snapshots=new Map(values.map(e=>[e.volume,e]));
      if(!snapshots.has(volume))volume=values[0].volume;index=Math.max(0,snapshots.get(volume)!.pages.findIndex(p=>p.number===leaf));navigation();controls();show();
    },
    set(e:Snapshot){
      if(finishedKey)return;
      if(!Array.isArray(e.pages)||!e.pages.length)return;
      const url=new URL(e.url,location.origin);if(url.origin!==location.origin||url.pathname!=='/api/edition-pages')return;
      const prior=snapshots.get(e.volume);if(prior&&prior.sequence>=e.sequence)return;
      snapshots.set(e.volume,e);if(!volume){volume=e.volume;index=Math.max(0,e.pages.findIndex(p=>p.text_mode==='prose'||p.label.startsWith('Page ')));}
      navigation();
      if(e.volume===volume){index=Math.min(index,e.pages.length-1);controls();show();}
    },
    activate(value:boolean){active=value;if(active)show();else{serial++;download?.abort();render?.cancel();$('draft-surface').setAttribute('aria-busy','false');}},
  };
}

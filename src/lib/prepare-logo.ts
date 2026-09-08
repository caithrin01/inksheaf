import {coverLogo,classifyLogoPixels} from '../../functions/lib/cover-logo.js';
export async function prepareLogo(publication:any){
  if(!publication.logo_url||coverLogo(publication).logo.startsWith('/book/'))return;
  // CORS failure preserves the source. No upload, proxy or altered bitmap is made.
  publication.logo_treatment=await new Promise(resolve=>{
    const img=new Image();let done=false;
    const finish=(value:object)=>{if(done)return;done=true;clearTimeout(timer);img.onload=null;img.onerror=null;resolve(value)};
    const timer=setTimeout(()=>finish({treatment:'original'}),3000);
    img.crossOrigin='anonymous';img.referrerPolicy='no-referrer';
    img.onload=()=>{
      try{
        const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
        const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
        ctx.drawImage(img,0,0,64,64);
        finish(classifyLogoPixels(ctx.getImageData(0,0,64,64).data,64,64));
      }catch{finish({treatment:'original'})}
    };
    img.onerror=()=>finish({treatment:'original'});img.src=publication.logo_url;
  });
}

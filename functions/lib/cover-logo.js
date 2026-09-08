import {coverColors} from './book-design.js';

const ownerHosts=new Set(['caithrin.com','www.caithrin.com','caithrin.substack.com']);
export function contrastingInk(hex){
  const luminance=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255)
    .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
    .reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
  const ground=luminance(hex),preferred=ground>.179?'#181a19':'#f2efe5',ink=luminance(preferred);
  if((Math.max(ground,ink)+.05)/(Math.min(ground,ink)+.05)>=4.5)return preferred;
  // Mid-tone original logo grounds sometimes need full black or white for small
  // cover labels. Preserve the artwork and its ground; change only our own text.
  return ground>.179?'#000000':'#ffffff';
}
// Only these verified author masters may replace a fetched logo. Other writers
// retain their own artwork. The transparent variants share the original geometry.
export function coverLogo(publication,cover='masthead'){
  const {host='',logo_url='',theme={},logo_treatment}=publication||{};
  if(!logo_url)return {logo:'',logoTreatment:'transparent'};
  if(ownerHosts.has(host.toLowerCase())){
    const light=['classic','field'].includes(cover)||cover==='masthead'&&['#181a19','#000000'].includes(contrastingInk(coverColors(cover,theme)[0]));
    return {logo:`/book/caithrin-mark-${light?'charcoal':'gold'}.svg`,logoTreatment:'transparent'};
  }
  const ground=logo_treatment?.background;
  return {logo:logo_url,logoTreatment:logo_treatment?.treatment==='band'&&/^#[0-9a-f]{6}$/i.test(ground)?'band':'transparent',
    ...(ground && /^#[0-9a-f]{6}$/i.test(ground)?{logoBackground:ground,logoInk:contrastingInk(ground)}:{})};
}

// Examine the unmodified source's outer pixels. Continue only a flat opaque
// ground; photographs and mixed edges stay intact. Never knock out or recolour.
export function classifyLogoPixels(data,width,height){
  const edges=[];
  for(let i=0;i<16;i++){
    const x=Math.round(i*(width-1)/15),y=Math.round(i*(height-1)/15);
    for(const [a,b] of [[x,0],[x,height-1],[0,y],[width-1,y]])edges.push([...data.slice((b*width+a)*4,(b*width+a)*4+4)]);
  }
  if(edges.every(p=>p[3]<12))return {treatment:'transparent'};
  const first=edges[0];
  if(edges.every(p=>p[3]>248&&p.slice(0,3).every((v,i)=>Math.abs(v-first[i])<=5))){
    return {treatment:'band',background:'#'+first.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('')};
  }
  return {treatment:'original'};
}

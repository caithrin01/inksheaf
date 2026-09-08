import { coverMarkup, coverStyle } from './book-design.js';
const theme={cover_bg:'#1d1e1d',cover_ink:'#ffffff'};
const definitions=[['masthead','Masthead','The publication’s colour. A bold name and its own mark.'],['classic','Classic','Centred literary type, a single frame and open space.'],['field','Field notes','Pale green and olive, with an asymmetric editorial structure.'],['midnight','Midnight','Blue-black, expressive italic type and one quiet rule.']];
const fixtures={caithrin:{publication:'caithrin',logo:'assets/example-caithrin-logo.png',kind:'Collected essays',dates:'2025 — 2026',foot:'caithrin.com'},fox:{publication:'The Fox Says',logo:'',kind:'Cover identity check',dates:'Design specimen',foot:'manifund.substack.com'},long:{publication:'Letters about the changing shape of work, technology, and everything we build together',logo:'',kind:'Long-title test',dates:'Design specimen',foot:'Fictional stress fixture'},unbroken:{publication:'APublicationWithASingleUnusuallyLongNameAndNoSpacesAtAll',logo:'',kind:'Unbroken-title test',dates:'Design specimen',foot:'Fictional stress fixture'}};
const notes={caithrin:'The owner’s real publication name and verified brand artwork. All four are proposed cover options.',fox:'Real publication-name regression: manifund → The Fox Says, never its author’s first name. No endorsement or printing permission is implied. No logo is invented.',long:'Fictional stress fixture. The entire title must fit and remain unchanged in every composition.',unbroken:'Fictional stress fixture. An unbroken title must wrap safely without losing letters.'};
const treatmentNotes={transparent:'Existing author-supplied transparent masters: charcoal on Classic and Field notes; gold on Masthead and Midnight. No automated background removal.',band:'Opaque original preserved inside a full-width publication band. The logo’s solid background becomes part of the composition.',original:'Before comparison: the original opaque image floats as a square on three covers. This is the rejected treatment.'};
function coverData(data,design,treatment){
  if(!data.logo)return {...data,logoTreatment:'transparent'};
  // This fixture has verified owner masters. Never assign its artwork to another publication.
  const logo=treatment==='transparent'&&data.logo===fixtures.caithrin.logo
    ?`assets/caithrin-mark-${['classic','field'].includes(design)?'charcoal':'gold'}.svg`
    :data.logo;
  return {...data,logo,logoTreatment:treatment==='band'?'band':'transparent'};
}
function coverFace(data,design,treatment){
  const resolved=coverData(data,design,treatment);
  return `<div class="cover-face ${resolved.logo&&resolved.logoTreatment==='band'?'logo-band':''}" data-design="${design}" style="${coverStyle(design,theme,data.publication)}">${coverMarkup(resolved)}</div>`;
}
function draw(){
  const key=document.querySelector('#publication-case').value;
  const data={...fixtures[key]};
  const treatment=document.querySelector('#logo-treatment').value;
  if(document.querySelector('#hide-logo').checked)data.logo='';
  document.querySelector('#cover-case-note').textContent=notes[key]+(data.logo?' '+treatmentNotes[treatment]:' The composition stands without a logo.');
  document.querySelector('#cover-gallery').innerHTML=definitions.map(([id,name,description],i)=>`<figure class="cover-specimen"><div class="physical-book">${coverFace(data,id,treatment)}</div><figcaption><h3>${name}<span>0${i+1}</span></h3><p>${description}</p></figcaption></figure>`).join('');
  document.querySelector('#object-book').innerHTML=coverFace(fixtures.caithrin,'classic',treatment);
}
draw();for(const id of ['publication-case','hide-logo','logo-treatment'])document.querySelector('#'+id).addEventListener('change',draw);
document.querySelector('#greyscale').addEventListener('click',e=>{const on=e.currentTarget.getAttribute('aria-pressed')!=='true';e.currentTarget.setAttribute('aria-pressed',String(on));e.currentTarget.textContent=on?'View in colour':'View in grayscale';document.querySelector('#cover-gallery').classList.toggle('grayscale',on);});
document.querySelector('#entry-form').addEventListener('submit',e=>{e.preventDefault();const input=document.querySelector('#guide-url');const msg=document.querySelector('#entry-message');const value=input.value.trim();const valid=/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(value);input.setAttribute('aria-invalid',String(!valid));msg.classList.toggle('error',!valid);msg.textContent=valid?'URL accepted in this component demo. The real site would now request the public archive.':'Enter your publication’s address, such as you.substack.com.';if(!valid)input.focus();});
document.querySelector('#copy-link').addEventListener('click',async()=>{const input=document.querySelector('#preview-link');const msg=document.querySelector('#copy-message');try{await navigator.clipboard.writeText(input.value);msg.textContent='Preview link copied. It opens a preview, not a purchase.';}catch{input.focus();input.select();msg.textContent='Link selected. Copy it from the field.';}});
for(const button of document.querySelectorAll('[data-example-button]'))button.addEventListener('click',()=>{document.querySelector('#example-button-status').textContent='Component interaction shown. No archive request, email or reservation was sent.';});

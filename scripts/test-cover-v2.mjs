import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {coverMarkup,coverStyle,coverColors,designSelection,validDesign} from '../functions/lib/book-design.js';
import {coverLogo,classifyLogoPixels} from '../functions/lib/cover-logo.js';
import {printCoverLogo} from './lib/print-logo.mjs';
let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS',name)};
test('new reservations use version 2; historical version 1 remains valid',()=>{
 assert.equal(designSelection('field').version,2);
 assert.ok(validDesign({version:1,cover:'midnight',palette:{cover_bg:'#25322e',cover_ink:'#f4eedf'}}));
 assert.deepEqual(coverColors('midnight',{},1),['#25322e','#f4eedf','#d9cda9']);
 assert.match(coverStyle('field',{},'Example',1),/--cover-paper:#e8e1ce/);
 assert.match(coverStyle('field',{},'Example'),/--cover-paper:#dce4c4/);
 assert.match(coverMarkup({version:1}),/class="edition-cover">/);
 assert.doesNotMatch(coverMarkup({version:1}),/logo-ground/);
});
test('only confirmed owner hosts use the transparent owner marks',()=>{
 const p={host:'caithrin.com',logo_url:'https://substackcdn.com/original.png',theme:{cover_bg:'#1d1e1d'}};
 assert.match(coverLogo(p,'classic').logo,/charcoal.svg$/);assert.match(coverLogo(p,'field').logo,/charcoal.svg$/);
 assert.match(coverLogo(p,'midnight').logo,/gold.svg$/);assert.match(coverLogo(p,'masthead').logo,/gold.svg$/);
 assert.equal(coverLogo({...p,host:'caithrin.com.attacker.invalid'}).logo,p.logo_url);
 assert.equal(coverLogo({...p,logo_url:null}).logo,'');
});
test('flat opaque logo background survives a reservation and changes footer contrast',()=>{
 const pixels=new Uint8ClampedArray(64*64*4);for(let i=0;i<pixels.length;i+=4)pixels.set([250,250,250,255],i);
 const treatment=classifyLogoPixels(pixels,64,64);assert.deepEqual(treatment,{treatment:'band',background:'#fafafa'});
 const saved=JSON.parse(JSON.stringify(designSelection('midnight',{},treatment)));
 assert.ok(validDesign(saved));
 const result=coverLogo({host:'example.substack.com',logo_url:'https://substackcdn.com/logo.png',logo_treatment:saved.logo},saved.cover);
 assert.equal(result.logoTreatment,'band');assert.equal(result.logoInk,'#181a19');
 const html=coverMarkup({...result,publication:'Example',foot:'22 essays',ids:true});
 assert.equal((html.match(/id="pv-cvpages"/g)||[]).length,1);assert.match(html,/--logo-ground:#fafafa/);
});
test('transparent and complex edges preserve original artwork',()=>{
 const pixels=new Uint8ClampedArray(32*32*4);assert.deepEqual(classifyLogoPixels(pixels,32,32),{treatment:'transparent'});
 pixels.set([0,0,0,255],0);assert.deepEqual(classifyLogoPixels(pixels,32,32),{treatment:'original'});
});
test('invalid logo settings and unsafe markup cannot enter the cover',()=>{
 assert.equal(validDesign({version:2,cover:'classic',logo:{treatment:'band',background:'red; background:url(bad)'}}),false);
 assert.equal(validDesign({version:2,cover:'classic',logo:{treatment:'knockout'}}),false);
 const html=coverMarkup({logo:'javascript:alert(1)',logoTreatment:'band',publication:'<script>bad</script>'});
 assert.doesNotMatch(html,/class="cv-logo-band"|src="javascript:|<script>/);
});
const result=await printCoverLogo(designSelection('classic'),{logo_url:'https://substackcdn.com/original.png'},'caithrin.com');
test('print embeds the same local transparent master without a network fetch',()=>{
 assert.equal(result.logo,'data:image/svg+xml;base64,'+readFileSync('public/book/caithrin-mark-charcoal.svg').toString('base64'));
});
console.log(`${count} cover version and logo policy checks passed`);

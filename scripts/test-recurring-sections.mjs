import{execFileSync}from'node:child_process';import{mkdirSync,writeFileSync,readFileSync}from'node:fs';import assert from'node:assert/strict';
const dir='proofs/fixtures';mkdirSync(dir,{recursive:true});
const publication={id:999123,name:'Fixture Journal',subdomain:'fixture'};
function build(name,sections){
 const posts=sections.map((section_name,i)=>({id:100+i,slug:`essay-${i}`,title:`An observation on subject ${i}`,post_date:`2026-02-${String(i+1).padStart(2,'0')}T12:00:00Z`,wordcount:300,audience:'everyone',type:'newsletter',publication_id:publication.id,publication,publishedBylines:[{name:'Fixture Author'}],section_name,body_html:'<p>'+('This paragraph reflects on a subject in detail. '.repeat(35))+'</p>'}));
 const fixture=`${dir}/${name}.json`,html=`${dir}/${name}.html`;writeFileSync(fixture,JSON.stringify(posts));
 execFileSync('node',['scripts/build-book.mjs','https://fixture.substack.com','--fixture',fixture,'--out',html],{stdio:'pipe',env:{...process.env,OPENROUTER_API_KEY:'',ANTHROPIC_API_KEY:''}});
 return{html:readFileSync(html,'utf8'),report:JSON.parse(readFileSync(html.replace('.html','.report.json')))};
}
const repeated=build('recurring-sections',['Film','Song','Film','Song','Film','Song']);
assert.deepEqual(repeated.report.parts,[]);assert.deepEqual(repeated.report.inlineSections,['Film','Song']);
assert.equal((repeated.html.match(/<section class="part"/g)||[]).length,0);
assert.equal(repeated.report.pubName,'Fixture Journal');
const grouped=build('grouped-sections',['Film','Film','Film','Song','Song','Song']);
assert.deepEqual(grouped.report.parts,['Film','Song']);assert.equal((grouped.html.match(/<section class="part"/g)||[]).length,2);
console.log('6 recurring-section checks passed');

// Reproducible draw from Substack's observed category leaderboards, not a claim
// to sample uniformly across the entire platform. No failed draw is replaced.
import{readFileSync,writeFileSync,existsSync}from'node:fs';import{randomBytes,createHash}from'node:crypto';
const dir='output/private-acceptance',seed=randomBytes(16).toString('hex');
if(existsSync(`${dir}/selection.json`))throw Error('A draw is already recorded; do not replace difficult cases.');
const pools=[],selected=[],used=new Set();
for(const category of ['technology','food','literature','culture']){
 const source=JSON.parse(readFileSync(`${dir}/category-${category}.json`));
 const pool=source.pubsForSeoLeaderboard.map(({pub},i)=>({rank:i+1,id:pub.id,name:pub.name,host:pub.custom_domain||`${pub.subdomain}.substack.com`,subdomain:pub.subdomain,logo_url:pub.logo_url}));
 pools.push({category,url:`https://substack.com/top/${category}`,publications:pool});
 const shuffled=pool.map(p=>({...p,draw:createHash('sha256').update(`${seed}:${category}:${p.id}`).digest('hex')})).sort((a,b)=>a.draw.localeCompare(b.draw));
 for(const p of shuffled){if(used.has(p.id))continue;selected.push({category,...p});used.add(p.id);if(selected.filter(x=>x.category===category).length===3)break;}
}
const manifest={created:new Date().toISOString(),seed,method:'Each category pool sorted by SHA256(seed:category:publication_id); first three distinct publications, retaining draw order and failures.',pools,selected};
writeFileSync(`${dir}/selection.json`,JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({seed,selected},null,2));

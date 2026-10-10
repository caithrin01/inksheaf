// Counts are not evidence of an individual exclusion. Only an identified post
// with a documented reason can account for selected writing absent from the PDF.
export function completeness({selected,printed,asides=[],reports=[],sourcePosts=[]}) {
  const slugOf=new Map(sourcePosts.filter(p=>p?.id&&p.slug).map(p=>[String(p.id),p.slug]));
  const cuts=new Map(),cutsById=new Map();
  for(const report of reports) for(const [key,reason] of [['guestCuts','guest post'],['ruleCuts','rule cut'],['mediaCuts','media only'],['editorExcluded','editor excluded']]) {
    if(!Array.isArray(report[key]))continue;
    for(const post of report[key]){
      if(!post?.slug)continue;
      const cut={slug:post.slug,reason:post.reason||reason};cuts.set(post.slug,cut);
      if(post.id!=null)cutsById.set(String(post.id),cut);
    }
  }
  const included=new Set(printed.map(String)),aside=new Set(asides.map(String)),missing=[],cut_by_rule=[];
  for(const id of new Set(selected.map(String))){
    if(included.has(id)||aside.has(id))continue;
    const cut=cutsById.get(id)||cuts.get(slugOf.get(id));
    if(cut)cut_by_rule.push({id,...cut});else missing.push({id,slug:slugOf.get(id)||null});
  }
  return {selected:new Set(selected.map(String)).size,printed:included.size,set_aside:aside.size,cut_by_rule,missing};
}

export async function readPublisherSelection(DB,id) {
  const row=await DB.prepare('SELECT revision,restored_json FROM publisher_selections WHERE signup_id=?').bind(id).first();
  return {revision:row?.revision||0,restored:Object.keys(JSON.parse(row?.restored_json||'{}'))};
}

// Lulu from the edge: token and cost quotes only. Nothing here can place a print job; that
// stays in scripts/press.mjs behind a person's explicit go (plan-end-to-end-v1, phase 4).
export function luluClient(env) {
  const KEY = env.LULU_CLIENT_KEY, SECRET = env.LULU_CLIENT_SECRET;
  if (!KEY || !SECRET) return null;
  const BASE = "https://api.lulu.com";
  async function token() {
    const r = await fetch(`${BASE}/auth/realms/glasstree/protocol/openid-connect/token`, { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: KEY, client_secret: SECRET }) });
    if (!r.ok) throw new Error(`lulu auth ${r.status}`);
    return (await r.json()).access_token;
  }
  return {
    async costQuote({ lineItems, address, level = "MAIL" }) {
      const t = await token();
      const r = await fetch(`${BASE}/print-job-cost-calculations/`, { method: "POST",
        headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
        body: JSON.stringify({ line_items: lineItems, shipping_address: address, shipping_option: level }) });
      const text = await r.text();
      if (!r.ok) { const e = new Error(`lulu quote ${r.status}`); e.detail = text.slice(0, 400); e.status = r.status; throw e; }
      return JSON.parse(text);
    },
  };
}

// Lulu Print API client, importable. Credentials come ONLY from environment variables
// (LULU_CLIENT_KEY / LULU_CLIENT_SECRET); nothing here logs or stores the secret or tokens.
// Production is opt-in per call site — the pipeline passes { production: true } explicitly
// because the account keys are production keys (sandbox returns 401 for them; see
// evidence/lulu-auth.md). No function here spends money except createPrintJob.

export const POD = "0600X0900.BW.STD.PB.060UW444.MXX"; // 6x9, BW std, perfect bound, 60# white, matte

export function makeClient({ production = false } = {}) {
  const KEY = process.env.LULU_CLIENT_KEY, SECRET = process.env.LULU_CLIENT_SECRET;
  if (!KEY || !SECRET) throw new Error("LULU_CLIENT_KEY / LULU_CLIENT_SECRET not set in the environment");
  const BASE = production ? "https://api.lulu.com" : "https://api.sandbox.lulu.com";
  let tok = null, tokExp = 0;

  async function token() {
    if (tok && Date.now() < tokExp - 30_000) return tok;
    const r = await fetch(`${BASE}/auth/realms/glasstree/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: KEY, client_secret: SECRET }),
    });
    if (!r.ok) throw new Error(`lulu auth ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    tok = d.access_token; tokExp = Date.now() + d.expires_in * 1000;
    return tok;
  }
  async function api(path, body, method = body ? "POST" : "GET") {
    const t = await token();
    const r = await fetch(`${BASE}${path}`, {
      method, headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path} ${r.status}: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : {};
  }

  return {
    base: BASE,
    api,
    coverDimensions: (pages, pod = POD) =>
      api("/cover-dimensions/", { pod_package_id: pod, interior_page_count: pages, unit: "pt" }),

    validateInterior: (url, pod = POD) =>
      api("/validate-interior/", { source_url: url, pod_package_id: pod }),
    validateInteriorStatus: id => api(`/validate-interior/${id}/`),
    validateCover: (url, pages, pod = POD) =>
      api("/validate-cover/", { source_url: url, pod_package_id: pod, interior_page_count: pages }),
    validateCoverStatus: id => api(`/validate-cover/${id}/`),

    // polls a validation to a terminal state; throws on ERROR with Lulu's message
    async pollValidation(kind, id, { timeoutMs = 300_000, everyMs = 5000 } = {}) {
      const get = kind === "interior" ? this.validateInteriorStatus : this.validateCoverStatus;
      const t0 = Date.now();
      for (;;) {
        const d = await get(id);
        if (d.status === "NORMALIZED" || d.status === "VALIDATED") return d;
        if (d.status === "ERROR")
          throw new Error(`${kind} validation ERROR: ${JSON.stringify(d.errors).slice(0, 500)}`);
        if (Date.now() - t0 > timeoutMs) throw new Error(`${kind} validation timeout in status ${d.status}`);
        await new Promise(r => setTimeout(r, everyMs));
      }
    },

    costQuote: (pages, address, { quantity = 1, level = "MAIL", pod = POD } = {}) =>
      api("/print-job-cost-calculations/", {
        line_items: [{ page_count: pages, pod_package_id: pod, quantity }],
        shipping_address: address, shipping_option: level,
      }),

    // REAL MONEY. pod_package_id must sit INSIDE printable_normalization (R9).
    createPrintJob: ({ externalId, title, pages, interiorUrl, coverUrl, address, level = "MAIL", quantity = 1, pod = POD }) =>
      api("/print-jobs/", {
        external_id: externalId, contact_email: "caithrin@caithrin.com",
        line_items: [{
          title, quantity,
          printable_normalization: {
            pod_package_id: pod,
            interior: { source_url: interiorUrl },
            cover: { source_url: coverUrl },
          },
        }],
        shipping_address: address, shipping_level: level,
      }),
    printJobStatus: id => api(`/print-jobs/${id}/`),
  };
}

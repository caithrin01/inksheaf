var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// api/event.js
var ALLOWED = /* @__PURE__ */ new Set(["view", "step2", "step3", "signup", "preview_ok", "preview_fail", "preview_fetch"]);
async function onRequest({ request, env }) {
  if (request.method !== "POST")
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }
  const event = String(body.event || "");
  if (!ALLOWED.has(event)) return new Response(null, { status: 204 });
  const session = String(body.session || "").slice(0, 16);
  await env.DB.prepare("INSERT INTO events (session, event) VALUES (?,?)").bind(session, event).run();
  return new Response(null, { status: 204 });
}
__name(onRequest, "onRequest");

// api/preview.js
var MAX_POSTS = 150;
var MAX_BYTES = 2e6;
var TIMEOUT_MS = 6e3;
var WINDOW_DAYS = 366;
async function onRequest2({ request, env }) {
  if (request.method !== "GET")
    return json({ ok: false, error: "method not allowed" }, 405, { allow: "GET" });
  const raw = new URL(request.url).searchParams.get("url") || "";
  const host = parseHost(raw);
  if (!host) return json({
    ok: false,
    error: "bad_host",
    message: "That does not look like a publication URL."
  }, 400);
  const cached = await env.DB.prepare(
    "SELECT payload, fetched_at FROM preview_cache WHERE host = ?"
  ).bind(host).first().catch(() => null);
  if (cached && Date.now() - Date.parse(cached.fetched_at) < 24 * 3600 * 1e3) {
    const pay = JSON.parse(cached.payload);
    if (pay.sample) return json({ ok: true, cached: true, ...pay });
  }
  const minute = (/* @__PURE__ */ new Date()).toISOString().slice(0, 16);
  const rl = await env.DB.prepare(
    "SELECT count(*) n FROM events WHERE event = 'preview_fetch' AND created_at > datetime('now','-60 seconds')"
  ).first().catch(() => ({ n: 0 }));
  if ((rl?.n || 0) >= 60)
    return json({
      ok: false,
      error: "busy",
      message: "Previews are busy right now. The signup below works without one."
    }, 429);
  await env.DB.prepare("INSERT INTO events (session, event) VALUES (?, 'preview_fetch')").bind(minute).run().catch(() => {
  });
  const result = await fetchArchive(host);
  if (!result.ok) {
    await env.DB.prepare("INSERT INTO events (session, event) VALUES ('', 'preview_fail')").run().catch(() => {
    });
    return json(result, result.status || 502);
  }
  await env.DB.prepare("INSERT INTO events (session, event) VALUES ('', 'preview_ok')").run().catch(() => {
  });
  await env.DB.prepare(
    "INSERT INTO preview_cache (host, fetched_at, payload) VALUES (?, datetime('now'), ?) ON CONFLICT(host) DO UPDATE SET fetched_at = datetime('now'), payload = excluded.payload"
  ).bind(host, JSON.stringify(result.data)).run().catch(() => {
  });
  return json({ ok: true, cached: false, ...result.data });
}
__name(onRequest2, "onRequest");
function parseHost(raw) {
  let u;
  try {
    u = new URL(raw.includes("://") ? raw : "https://" + raw);
  } catch {
    return null;
  }
  const h = u.hostname.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
  if (h.includes(":")) return null;
  if (/(^|\.)(localhost|local|internal|home|lan|corp|test|invalid)$/.test(h)) return null;
  return h;
}
__name(parseHost, "parseHost");
async function fetchArchive(host) {
  const posts = [];
  const cutoff = Date.now() - WINDOW_DAYS * 24 * 3600 * 1e3;
  let hops = 0;
  for (let offset = 0; offset < MAX_POSTS; ) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let resp;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        resp = await fetch(`https://${host}/api/v1/archive?sort=new&offset=${offset}&limit=25`, {
          redirect: "manual",
          signal: ctl.signal,
          headers: { accept: "application/json", "user-agent": "inksheaf-preview/1.0 (+https://inksheaf.pages.dev)" }
        });
      } catch {
        clearTimeout(timer);
        return {
          ok: false,
          error: "unreachable",
          status: 502,
          message: "Could not reach that publication. The signup below works without a preview."
        };
      }
      if ((resp.status === 429 || resp.status >= 500) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      break;
    }
    clearTimeout(timer);
    if (resp.status === 429)
      return {
        ok: false,
        error: "upstream_busy",
        status: 503,
        upstream: 429,
        message: "Substack is rate-limiting our reader for that publication right now. Try again in a minute, or sign up below and we will send your preview by email."
      };
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location") || "";
      const nextHost = parseHost(loc.startsWith("http") ? loc : `https://${host}${loc}`);
      if (nextHost && nextHost !== host && hops < 2) {
        hops++;
        host = nextHost;
        continue;
      }
      return {
        ok: false,
        error: "redirect",
        status: 502,
        message: "That address redirects somewhere we could not follow. Try the publication's final URL."
      };
    }
    if (!resp.ok)
      return {
        ok: false,
        error: "not_substack",
        status: 502,
        upstream: resp.status,
        message: "Could not read an archive there. Is this a Substack publication URL?"
      };
    const text = (await resp.text()).slice(0, MAX_BYTES);
    let page;
    try {
      page = JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: "not_substack",
        status: 502,
        message: "That page did not answer like a Substack archive. Is this the publication's URL?"
      };
    }
    if (!Array.isArray(page))
      return {
        ok: false,
        error: "not_substack",
        status: 502,
        message: "That page did not answer like a Substack archive. Is this the publication's URL?"
      };
    if (!page.length) break;
    posts.push(...page);
    offset += page.length;
    if (page.length && Date.parse(page[page.length - 1].post_date || 0) < cutoff) break;
  }
  const recent = posts.filter((p) => p && p.post_date && Date.parse(p.post_date) >= cutoff && (p.type === "newsletter" || p.type === "podcast" || !p.type));
  if (!recent.length)
    return {
      ok: false,
      error: "empty",
      status: 200,
      message: "The public archive there looks empty for the last year. Paid-only archives preview after you join the beta."
    };
  const words = recent.reduce((s, p) => s + (Number(p.wordcount) || 0), 0);
  const dates = recent.map((p) => Date.parse(p.post_date)).sort((a, b) => a - b);
  const pages = Math.max(30, Math.round(words / 270 + recent.length * 1 + 10));
  const capped = posts.length >= MAX_POSTS;
  return { ok: true, data: {
    host,
    publication: recent[0].publishedBylines?.[0]?.name || host.split(".")[0],
    posts: recent.length,
    capped,
    words,
    est_pages: pages,
    from: new Date(dates[0]).toISOString().slice(0, 10),
    to: new Date(dates[dates.length - 1]).toISOString().slice(0, 10),
    titles: recent.slice(0, 5).map((p) => String(p.title || "").slice(0, 90)),
    sample: recent.slice(0, 6).map((p) => ({
      t: String(p.title || "").slice(0, 80),
      d: String(p.post_date || "").slice(0, 10),
      w: Number(p.wordcount) || 0
    })),
    theme: await fetchTheme(host, recent[0]?.slug)
  } };
}
__name(fetchArchive, "fetchArchive");
async function fetchTheme(host, slug) {
  if (!slug) return null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const r = await fetch(`https://${host}/api/v1/posts/${encodeURIComponent(slug)}`, {
      redirect: "manual",
      signal: ctl.signal,
      headers: { accept: "application/json", "user-agent": "inksheaf-preview/1.0 (+https://inksheaf.pages.dev)" }
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const tv = JSON.parse((await r.text()).slice(0, MAX_BYTES))?.themeVariables || {};
    const bg = parseColor(tv.cover_bg_color || tv.web_bg_color);
    let ink = parseColor(tv.cover_print_primary || tv.print_on_pop);
    if (bg && !ink) ink = lum(bg) < 0.45 ? [255, 255, 255] : [34, 29, 22];
    if (!bg || !ink || contrast(bg, ink) < 3) return null;
    const ink2 = lum(bg) < 0.45 ? [217, 217, 217] : [90, 85, 75];
    return {
      cover_bg: hex(bg),
      cover_ink: hex(ink),
      cover_ink2: hex(ink2),
      accent: tv.color_theme_accent || tv.background_pop || null,
      heading_stack: String(tv.font_family_headings_preset || "").slice(0, 200) || null
    };
  } catch {
    return null;
  }
}
__name(fetchTheme, "fetchTheme");
function parseColor(c) {
  if (!c || typeof c !== "string") return null;
  const m = c.trim().match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  const rgb = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return rgb ? [+rgb[1], +rgb[2], +rgb[3]] : null;
}
__name(parseColor, "parseColor");
var lum = /* @__PURE__ */ __name(([r, g, b]) => {
  const f = /* @__PURE__ */ __name((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }, "f");
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}, "lum");
var contrast = /* @__PURE__ */ __name((a, b) => {
  const [x, y] = [lum(a) + 0.05, lum(b) + 0.05];
  return x > y ? x / y : y / x;
}, "contrast");
var hex = /* @__PURE__ */ __name((rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join(""), "hex");
var json = /* @__PURE__ */ __name((body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store", ...extra }
}), "json");

// api/signup.js
var FIELDS = [
  "publication_url",
  "name",
  "role",
  "email",
  "archive_type",
  "frequency",
  "posts_per_year",
  "cadence_pref",
  "us_subscribers",
  "expected_orders",
  "founding_count",
  "price_range",
  "interview_ok",
  "concern"
];
async function onRequest3({ request, env }) {
  if (request.method !== "POST")
    return new Response(
      JSON.stringify({ ok: false, error: "method not allowed" }),
      { status: 405, headers: { "content-type": "application/json", "allow": "POST" } }
    );
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("invalid json");
  }
  if (body.website) return ok();
  const url = String(body.publication_url || "").trim();
  const email = String(body.email || "").trim();
  if (url.length > 300) return bad("url too long");
  if (email.length > 200) return bad("email too long");
  try {
    new URL(url);
  } catch {
    return bad("bad url");
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("bad email");
  const clean = {};
  for (const k of FIELDS) clean[k] = body[k] == null ? null : String(body[k]).slice(0, 300);
  clean.posts_per_year = Number.parseInt(clean.posts_per_year, 10) || null;
  const dupe = await env.DB.prepare(
    "SELECT id FROM signups WHERE email = ? AND publication_url = ? LIMIT 1"
  ).bind(email, url).first();
  if (dupe) return ok();
  await env.DB.prepare(
    `INSERT INTO signups (publication_url,name,role,email,archive_type,frequency,
       posts_per_year,cadence_pref,us_subscribers,expected_orders,founding_count,
       price_range,interview_ok,concern,raw_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    clean.publication_url,
    clean.name,
    clean.role,
    clean.email,
    clean.archive_type,
    clean.frequency,
    clean.posts_per_year,
    clean.cadence_pref,
    clean.us_subscribers,
    clean.expected_orders,
    clean.founding_count,
    clean.price_range,
    clean.interview_ok,
    clean.concern,
    JSON.stringify(clean)
  ).run();
  return ok();
}
__name(onRequest3, "onRequest");
var ok = /* @__PURE__ */ __name(() => new Response(
  JSON.stringify({ ok: true }),
  { headers: { "content-type": "application/json" } }
), "ok");
var bad = /* @__PURE__ */ __name((m) => new Response(
  JSON.stringify({ ok: false, error: m }),
  { status: 400, headers: { "content-type": "application/json" } }
), "bad");

// ../.wrangler/tmp/pages-paNPkA/functionsRoutes-0.5431141548234159.mjs
var routes = [
  {
    routePath: "/api/event",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest]
  },
  {
    routePath: "/api/preview",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest2]
  },
  {
    routePath: "/api/signup",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest3]
  }
];

// ../../../../../opt/homebrew/lib/node_modules/wrangler/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// ../.wrangler/tmp/bundle-QhK5c0/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../.wrangler/tmp/bundle-QhK5c0/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=functionsWorker-0.7100482333170599.mjs.map

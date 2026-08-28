import { onRequest as __api_event_js_onRequest } from "/Users/caithrinrintoul/repos/inksheaf/functions/api/event.js"
import { onRequest as __api_preview_js_onRequest } from "/Users/caithrinrintoul/repos/inksheaf/functions/api/preview.js"
import { onRequest as __api_signup_js_onRequest } from "/Users/caithrinrintoul/repos/inksheaf/functions/api/signup.js"

export const routes = [
    {
      routePath: "/api/event",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_event_js_onRequest],
    },
  {
      routePath: "/api/preview",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_preview_js_onRequest],
    },
  {
      routePath: "/api/signup",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_signup_js_onRequest],
    },
  ]
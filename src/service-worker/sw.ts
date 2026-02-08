/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core"
import { NavigationRoute, registerRoute } from "workbox-routing"
import { precacheAndRoute } from "workbox-precaching"
import { CacheFirst } from "workbox-strategies"

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any }

clientsClaim()

self.addEventListener("message", e => {
  if (e.data.method === "swSkipWaiting") {
    self.skipWaiting()
    e.stopImmediatePropagation()
  }
})

precacheAndRoute(self.__WB_MANIFEST)

registerRoute(new NavigationRoute(async function handleNotFound({ request }) {
  const response = await fetch(request)
  if (response.status === 404)
    return new Response(null, { status: 302, headers: { location: "/" } })
  return response
}))

// onnx and wasm files are excluded from precaching, so we need to route them separately
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && /\.(onnx|wasm)$/.test(url.pathname),
  new CacheFirst(),
)

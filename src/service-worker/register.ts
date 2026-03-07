import "./sw?serviceWorker"
import { signal } from "@preact/signals"


export const isFirstInstalled = signal(false)
export const isControlled = signal(!!navigator.serviceWorker?.controller)
export const hasUpdate = signal<() => void>()


function handleRegistration(registration: ServiceWorkerRegistration) {
  if (registration.waiting) {
    hasUpdate.value = () => {
      registration.waiting?.postMessage({ method: "swSkipWaiting" })
    }
  }
  registration.onupdatefound = () => {
    const installingWorker = registration.installing
    if (!installingWorker)
      return

    installingWorker.onstatechange = () => {
      if (installingWorker.state === "installed" && isControlled.value) {
        hasUpdate.value = () => {
          installingWorker.postMessage({ method: "swSkipWaiting" })
        }
      }
      else {
        isFirstInstalled.value = true
      }
    }
  }
}


export function register() {
  const publicUrl = new URL(import.meta.env.BASE_URL, window.location.href)
  if (
    import.meta.env.PROD &&
    "serviceWorker" in navigator &&
    publicUrl.origin === window.location.origin
  ) {
    const swUrl = new URL("sw.js", publicUrl)

    navigator.serviceWorker
      .register(swUrl)
      .then(handleRegistration)
      .catch(error => console.error("Error registering service worker:", error))

    // when a service worker skip waiting, reload all pages
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (isControlled.value)
        window.location.reload()
      else
        isControlled.value = true
    })
  }
  else {
    unregister()
  }
}

export function unregister() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then(registration => registration.unregister())
      .catch(error => console.error(error.message))
  }
}

import { effect } from "@preact/signals"
import { showToast } from "./toastState"
import { hasUpdate, isFirstInstalled, isControlled, register } from "./register"

let serviceWorkerNotificationsReady = false
let hasShownControlled = false

export function setupServiceWorkerNotifications() {
  if (serviceWorkerNotificationsReady) return
  serviceWorkerNotificationsReady = true

  register()

  effect(() => {
    if (!isFirstInstalled.value) return
    showToast({
      title: "Offline ready",
      message: "This app is cached and can be used without a connection.",
      tone: "success",
    })
  })

  effect(() => {
    const applyUpdate = hasUpdate.value
    if (!applyUpdate) return
    showToast({
      title: "Update available",
      message: "Reload to use the latest version.",
      tone: "warning",
      timeoutMs: 12000,
      action: {
        label: "Reload",
        onClick: () => applyUpdate(),
      },
    })
  })
}

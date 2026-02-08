import { signal } from "@preact/signals"

export type ToastTone = "info" | "success" | "warning" | "error"
export type ToastAction = { label: string; onClick: () => void }

export type ToastItem = {
  id: string
  title: string
  message?: string
  tone: ToastTone
  action?: ToastAction
  timeoutMs: number
  createdAt: number
}

export type ToastInput = {
  title: string
  message?: string
  tone?: ToastTone
  action?: ToastAction
  timeoutMs?: number
}

export const toasts = signal<ToastItem[]>([])

let toastCounter = 0
const timeouts = new Map<string, any>()

const exitDurationMs = 300

function nextToastId() {
  toastCounter += 1
  return `toast-${Date.now()}-${toastCounter}`
}

function clearToastTimer(id: string) {
  const timer = timeouts.get(id)
  if (timer) {
    clearTimeout(timer)
    timeouts.delete(id)
  }
}

export function dismissToast(id: string) {
  const current = toasts.peek()
  if (!current.some(toast => toast.id === id)) return
  clearToastTimer(id)
  setTimeout(() => {
    toasts.value = current.filter(toast => toast.id !== id)
  })
}

export function showToast(input: ToastInput) {
  const id = nextToastId()
  const toast: ToastItem = {
    id,
    title: input.title,
    message: input.message,
    tone: input.tone ?? "info",
    action: input.action,
    timeoutMs: input.timeoutMs ?? 4500,
    createdAt: Date.now(),
  }

  setTimeout(() => {
    toasts.value = [toast, ...toasts.peek()].slice(0, 4)
  })

  if (toast.timeoutMs > 0) {
    const timer = setTimeout(() => dismissToast(id), toast.timeoutMs)
    timeouts.set(id, timer)
  }
}

export function getToastExitDuration() {
  return exitDurationMs
}

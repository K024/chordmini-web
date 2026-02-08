import clsx from "clsx"
import { createPortal } from "preact/compat"
import { TransitionGroup, useTransitionState } from "../components/TransitionGroup"
import { dismissToast, getToastExitDuration, toasts, type ToastTone } from "./toastState"

const toneStyles: Record<ToastTone, { ring: string; border: string; badge: string; text: string }> = {
  info: {
    ring: "ring-sky-200/70",
    border: "border-sky-200",
    badge: "bg-sky-100 text-sky-700",
    text: "text-slate-700",
  },
  success: {
    ring: "ring-emerald-200/70",
    border: "border-emerald-200",
    badge: "bg-emerald-100 text-emerald-700",
    text: "text-slate-700",
  },
  warning: {
    ring: "ring-amber-200/70",
    border: "border-amber-200",
    badge: "bg-amber-100 text-amber-700",
    text: "text-slate-700",
  },
  error: {
    ring: "ring-rose-200/70",
    border: "border-rose-200",
    badge: "bg-rose-100 text-rose-700",
    text: "text-slate-700",
  },
}

const toneGlyph: Record<ToastTone, string> = {
  info: "i",
  success: "OK",
  warning: "!",
  error: "!",
}

let toastRoot: HTMLElement | null = null

function ensureToastRoot() {
  if (typeof document === "undefined") return null
  if (!toastRoot) {
    toastRoot = document.getElementById("toast-root")
    if (!toastRoot) {
      toastRoot = document.createElement("div")
      toastRoot.id = "toast-root"
      document.body.appendChild(toastRoot)
    }
  }
  return toastRoot
}

function ToastCard({ toast, show = true }: { toast: typeof toasts.value[number]; show?: boolean }) {
  const tone = toneStyles[toast.tone]
  const { beforeOpen, closing } = useTransitionState(show, 300, true)
  return (
    <div
      role="status"
      aria-live="polite"
      class={clsx(
        "pointer-events-auto rounded-2xl border bg-white/95 p-4 shadow-xl ring-1 backdrop-blur-sm transition duration-300",
        (beforeOpen || closing) && "translate-y-2 opacity-0",
        tone.border,
        tone.ring,
      )}
    >
      <div class="flex items-start gap-3">
        <span
          class={clsx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-semibold uppercase",
            tone.badge,
          )}
        >
          {toneGlyph[toast.tone]}
        </span>
        <div class="flex-1">
          <p class="text-sm font-semibold text-slate-900">{toast.title}</p>
          {toast.message ? (
            <p class={clsx("mt-1 text-sm", tone.text)}>
              {toast.message}
            </p>
          ) : null}
          {toast.action ? (
            <button
              type="button"
              class="mt-3 rounded-full bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800"
              onClick={() => {
                toast.action?.onClick()
                dismissToast(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Dismiss notification"
          class="rounded-full px-2 py-1 text-xs font-semibold text-slate-400 transition hover:text-slate-600"
          onClick={() => dismissToast(toast.id)}
        >
          x
        </button>
      </div>
    </div>
  )
}

export function ToastViewport() {
  const root = ensureToastRoot()
  if (!root) return null

  return createPortal(
    <div class="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[min(360px,92vw)] flex-col gap-3">
      <TransitionGroup exitDuration={getToastExitDuration()}>
        {toasts.value.map(toast => (
          <ToastCard key={toast.id} toast={toast} />
        ))}
      </TransitionGroup>
    </div>,
    root
  )
}

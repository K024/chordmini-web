import clsx from "clsx"
import { error, errorStep, status, statusMessage, type AppStatus } from "./appState"


const steps = [
  { id: "preprocess", label: "Preprocess audio (hybrid CQT)" },
  { id: "infer", label: "Infer all models + average" },
  { id: "decode", label: "HMM decode chords" },
]


function AppStatusBadge() {
  return (
    <span
      class={clsx(
        "shrink-0 rounded-full px-3 py-1 text-xs font-semibold",
        status.value === "error"
          ? "bg-rose-100 text-rose-700"
          : status.value === "ready"
            ? "bg-emerald-100 text-emerald-700"
            : status.value === "idle"
              ? "bg-slate-100 text-slate-500"
              : "bg-amber-100 text-amber-700"
      )}
    >
      {status.value === "error"
        ? "Error"
        : status.value === "ready"
          ? "Complete"
          : status.value === "idle"
            ? "Idle"
            : "Running"}
    </span>
  )
}


function ProgressTitle() {
  return (
    <div>
      <h2 class="text-lg font-semibold text-slate-900">Progress</h2>
      <p class="text-sm text-slate-500">{statusMessage.value}</p>
    </div>
  )
}


function getStepState(status: AppStatus, index: number, errorStep: number | null) {
  if (status === "error") {
    if (errorStep === index) return "error"
    if (errorStep !== null && index < errorStep) return "done"
    return "pending"
  }
  if (status === "ready") {
    return "done"
  }
  if (status === "decoding") {
    if (index < 2) return "done"
    return index === 2 ? "active" : "pending"
  }
  if (status === "inferring") {
    if (index === 0) return "done"
    return index === 1 ? "active" : "pending"
  }
  if (status === "preprocessing") {
    return index === 0 ? "active" : "pending"
  }
  return "pending"
}


function ProgressStep({ step, index }: { step: typeof steps[number]; index: number }) {
  const state = getStepState(status.value, index, errorStep.value)
  return (
    <div class="flex items-center gap-3">
      <div
        class={clsx(
          "flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold",
          state === "done" && "border-emerald-400 bg-emerald-500 text-white",
          state === "active" && "border-amber-400 bg-amber-100 text-amber-700",
          state === "error" && "border-rose-400 bg-rose-100 text-rose-700",
          state === "pending" && "border-slate-200 bg-white text-slate-400"
        )}
      >
        {index + 1}
      </div>
      <div class="flex-1">
        <p class="text-sm font-semibold text-slate-700">{step.label}</p>
        {state === "active" ? (
          <p class="text-xs text-slate-500">Working on this step now.</p>
        ) : null}
      </div>
    </div>
  )
}


function ProgressError() {
  if (!error.value) return null
  return (
    <div class="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {error.value}
    </div>
  )
}


export function ProgressPanel() {
  return (
    <div class="rounded-2xl bg-white p-6 shadow-sm">
      <div class="flex items-start justify-between gap-4">
        <ProgressTitle />
        <AppStatusBadge />
      </div>
      <div class="mt-6 space-y-4">
        {steps.map((step, index) => {
          return <ProgressStep key={step.id} step={step} index={index} />
        })}
      </div>
      <ProgressError />
    </div>
  )
}

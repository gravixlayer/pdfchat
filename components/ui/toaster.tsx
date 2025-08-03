"use client"

import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast"
import { useToast } from "@/hooks/use-toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(({ id, title, description, action, ...props }) => (
        <Toast key={id} {...props} className="rounded-lg border-[#333] bg-[#1a1a1a] shadow-xl">
          <div className="grid gap-1">
            {title && <ToastTitle className="text-white text-sm font-semibold">{title}</ToastTitle>}
            {description && <ToastDescription className="text-[#e0e0e0] text-xs">{description}</ToastDescription>}
          </div>
          {action}
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  )
}

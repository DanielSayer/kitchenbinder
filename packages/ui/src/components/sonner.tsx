"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          // Pantry: ink toasts with a butter action; soft tones for rich colours.
          "--normal-bg": "var(--ink, #2b1d14)",
          "--normal-text": "var(--paper, #f7f0e3)",
          "--normal-border": "var(--ink, #2b1d14)",
          "--success-bg": "var(--olive-soft, #e4e5c8)",
          "--success-text": "var(--olive, #5e6b2f)",
          "--success-border": "var(--olive-soft, #e4e5c8)",
          "--error-bg": "var(--tomato-soft, #f6dcd3)",
          "--error-text": "var(--tomato-press, #a2321f)",
          "--error-border": "var(--tomato-soft, #f6dcd3)",
          "--warning-bg": "var(--butter-soft, #f8eacb)",
          "--warning-text": "var(--butter-ink, #8a5d0a)",
          "--warning-border": "var(--butter-soft, #f8eacb)",
          "--info-bg": "var(--card, #fffbf4)",
          "--info-text": "var(--ink, #2b1d14)",
          "--info-border": "var(--line, #e3d5be)",
          "--border-radius": "var(--r-m, 16px)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

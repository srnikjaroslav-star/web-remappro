import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="bottom-right"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast items-center gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-md",
          title: "text-sm font-semibold leading-snug !text-white",
          description: "text-xs leading-snug !text-white/80",
          icon: "shrink-0 [&_svg]:h-5 [&_svg]:w-5",
          success:
            "!bg-cyan-500/20 !border-cyan-400/70 !text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.35)] [&_[data-icon]]:!text-cyan-300",
          info:
            "!bg-cyan-500/20 !border-cyan-400/70 !text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.35)] [&_[data-icon]]:!text-cyan-300",
          warning:
            "!bg-orange-500/20 !border-orange-400/70 !text-orange-50 shadow-[0_0_24px_rgba(251,146,60,0.35)] [&_[data-icon]]:!text-orange-300",
          error:
            "!bg-red-500/20 !border-red-400/70 !text-red-50 shadow-[0_0_24px_rgba(248,113,113,0.35)] [&_[data-icon]]:!text-red-300",
          actionButton: "!bg-white/10 !text-white",
          cancelButton: "!bg-white/10 !text-white/80",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };

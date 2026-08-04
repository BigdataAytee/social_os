import { Logo } from "@/components/shell/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas px-6 py-12">
      {/* A single soft gold wash — the only decorative color in the product (§7). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          background:
            "radial-gradient(60rem 40rem at 50% -10%, rgb(var(--accent)), transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-sm animate-fade-in">
        <div className="mb-10 flex flex-col items-center gap-3 text-center">
          <Logo />
          <p className="max-w-xs text-balance text-sm text-secondary">
            Five Studios, one calendar, one voice.
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StartupRecovery({ onRetry }: { onRetry: () => void }) {
  return <main role="alert" className="min-h-dvh flex items-center justify-center p-6" style={{ background: "var(--nvu-page)", color: "var(--nvu-text)" }}>
    <section className="w-full max-w-sm rounded-2xl border p-6 text-center" style={{ background: "var(--nvu-surface)", borderColor: "var(--nvu-line)" }}>
      <strong className="text-lg">NVU</strong><h1 className="mt-3 text-base font-semibold">Não foi possível preparar o aplicativo</h1>
      <p className="mt-2 text-sm" style={{ color: "var(--nvu-muted)" }}>Os registros salvos foram preservados. Tente novamente para retomar a abertura.</p>
      <button type="button" onClick={onRetry} className="mt-5 min-h-11 w-full rounded-xl px-4 font-semibold" style={{ background: "var(--nvu-accent)", color: "#10212b" }}>Tentar novamente</button>
    </section>
  </main>;
}

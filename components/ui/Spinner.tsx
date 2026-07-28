export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8" role="status">
      <span className="size-8 animate-spin rounded-full border-3 border-line border-t-accent" />
      {label ? <p className="text-base font-semibold text-muted">{label}</p> : null}
    </div>
  );
}

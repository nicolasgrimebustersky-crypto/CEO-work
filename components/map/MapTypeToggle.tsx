"use client";

export type MapTypeOption = "satellite" | "hybrid" | "roadmap";

const OPTIONS: { value: MapTypeOption; label: string }[] = [
  { value: "satellite", label: "Sat" },
  { value: "hybrid", label: "Hybrid" },
  { value: "roadmap", label: "Street" },
];

export function MapTypeToggle({
  value,
  onChange,
}: {
  value: MapTypeOption;
  onChange: (value: MapTypeOption) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Map type"
      className="flex overflow-hidden rounded-xl border border-line bg-base/85 backdrop-blur-sm"
    >
      {OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`tap-target px-3 py-2 text-sm font-bold transition ${
              active ? "bg-accent text-accent-ink" : "text-ink hover:bg-surface-2"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

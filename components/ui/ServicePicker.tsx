"use client";

import { Chip } from "@/components/ui/Chips";
import { SERVICE_LABEL } from "@/lib/status";
import {
  MAIN_SERVICES,
  subServicesFor,
  toggleMain,
  toggleSub,
  type ServiceSelection,
} from "@/lib/subServices";

/**
 * Pick one or more main services, then any of the specific services under
 * each. Used by the job form and the estimate builder so both offer exactly
 * the same choices.
 *
 * Every chip toggles; the last main service cannot be turned off, because a
 * record with no service has nothing to price or report against.
 */
export function ServicePicker({
  value,
  onChange,
}: {
  value: ServiceSelection;
  onChange: (next: ServiceSelection) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1.5 text-sm font-semibold text-muted">
          Services <span className="font-normal">— pick as many as apply</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {MAIN_SERVICES.map((main) => (
            <Chip
              key={main}
              active={value.serviceTypes.includes(main)}
              onClick={() => onChange(toggleMain(value, main))}
            >
              {SERVICE_LABEL[main]}
            </Chip>
          ))}
        </div>
      </div>

      {value.serviceTypes.map((main) => (
        <div key={main} className="rounded-xl border border-line bg-surface-2/50 p-3">
          <p className="mb-1.5 text-sm font-semibold text-muted">
            {SERVICE_LABEL[main]} <span className="font-normal">— what exactly? (optional)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {subServicesFor(main).map((sub) => (
              <Chip
                key={sub.key}
                active={value.subServices.includes(sub.key)}
                onClick={() => onChange(toggleSub(value, sub.key))}
              >
                {sub.label}
              </Chip>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

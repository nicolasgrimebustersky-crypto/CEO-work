"use client";

import { useTeam } from "@/components/providers/TeamProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { Sheet } from "@/components/ui/Sheet";
import { CONTACT_RECENCY_OPTIONS, EMPTY_FILTERS } from "@/lib/filters";
import type { ContactRecency, CustomerFilters } from "@/lib/filters";
import { SERVICE_LABEL, STATUS_LABEL } from "@/lib/status";
import { CUSTOMER_STATUSES, SERVICE_TYPES } from "@/lib/types";
import type { CustomerStatus, ServiceType } from "@/lib/types";

interface FilterSheetProps {
  open: boolean;
  filters: CustomerFilters;
  matchCount: number;
  onChange: (filters: CustomerFilters) => void;
  onClose: () => void;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function FilterSheet({
  open,
  filters,
  matchCount,
  onChange,
  onClose,
}: FilterSheetProps) {
  const { users, colorFor } = useTeam();

  return (
    <Sheet
      open={open}
      title="Filters"
      onClose={onClose}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => onChange(EMPTY_FILTERS)}>
            Clear all
          </Button>
          <Button full onClick={onClose}>
            Show {matchCount} {matchCount === 1 ? "pin" : "pins"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <section>
          <h3 className="mb-2 text-base font-bold text-ink">Status</h3>
          <div className="flex flex-wrap gap-2">
            {CUSTOMER_STATUSES.map((status: CustomerStatus) => (
              <Chip
                key={status}
                active={filters.statuses.includes(status)}
                onClick={() =>
                  onChange({ ...filters, statuses: toggle(filters.statuses, status) })
                }
              >
                {STATUS_LABEL[status]}
              </Chip>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-base font-bold text-ink">Service</h3>
          <div className="flex flex-wrap gap-2">
            {SERVICE_TYPES.map((service: ServiceType) => (
              <Chip
                key={service}
                active={filters.serviceTypes.includes(service)}
                onClick={() =>
                  onChange({
                    ...filters,
                    serviceTypes: toggle(filters.serviceTypes, service),
                  })
                }
              >
                {SERVICE_LABEL[service]}
              </Chip>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-base font-bold text-ink">Last contacted</h3>
          <div className="flex flex-wrap gap-2">
            {CONTACT_RECENCY_OPTIONS.map((option) => (
              <Chip
                key={option.value}
                active={filters.recency === option.value}
                onClick={() =>
                  onChange({ ...filters, recency: option.value as ContactRecency })
                }
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-base font-bold text-ink">Logged by</h3>
          <div className="flex flex-wrap gap-2">
            <Chip
              active={filters.loggedBy === null}
              onClick={() => onChange({ ...filters, loggedBy: null })}
            >
              Anyone
            </Chip>
            {users.map((user) => (
              <Chip
                key={user.uid}
                active={filters.loggedBy === user.uid}
                onClick={() => onChange({ ...filters, loggedBy: user.uid })}
              >
                <span
                  className="mr-2 inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: colorFor(user.uid) }}
                />
                {user.displayName}
              </Chip>
            ))}
          </div>
        </section>
      </div>
    </Sheet>
  );
}

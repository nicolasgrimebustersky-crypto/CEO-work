import { SERVICE_LABEL } from "@/lib/status";
import { describeSelection } from "@/lib/subServices";
import type { ServiceType } from "@/lib/types";

/**
 * Everything a job or estimate covers, in words: "House & siding wash and
 * Mulching", or "Pressure washing" when nothing more specific was picked.
 *
 * The one place records are turned into a service description, so the
 * calendar, the customer's texts, the PDF and the emails all agree.
 */
export function servicesLabel(record: {
  serviceType: ServiceType;
  serviceTypes?: ServiceType[];
  subServices?: string[];
}): string {
  return describeSelection(
    {
      serviceTypes: record.serviceTypes?.length ? record.serviceTypes : [record.serviceType],
      subServices: record.subServices ?? [],
    },
    (main) => SERVICE_LABEL[main],
  );
}

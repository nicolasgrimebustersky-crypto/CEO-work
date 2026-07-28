import { CustomerDetailScreen } from "@/components/customers/CustomerDetailScreen";

/** Next 15 hands route params to server components as a promise. */
export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CustomerDetailScreen customerId={id} />;
}

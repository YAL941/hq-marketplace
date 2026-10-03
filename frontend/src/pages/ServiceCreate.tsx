import { ServiceFormPage } from './ServiceForm';

/**
 * The create route. The form is shared with the edit screen so both send the
 * same validated payload; see `ServiceFormPage`.
 */
export function ServiceCreatePage() {
  return <ServiceFormPage />;
}
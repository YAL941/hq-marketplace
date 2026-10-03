import { ProductFormPage } from './ProductForm';

/**
 * Kept as its own module because `/dashboard/products/new` is its own route and
 * App.tsx imports a named component per route. The form itself is shared with
 * the edit screen so the two cannot drift apart in validation or payload shape.
 */
export function ProductCreatePage() {
  return <ProductFormPage />;
}
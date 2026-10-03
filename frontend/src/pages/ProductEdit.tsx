import { ProductFormPage } from './ProductForm';

/**
 * The edit screen. `ProductFormPage` reads `:productId` from the route and
 * switches to loading an existing product when it is present, so the form and
 * its validation live in one place instead of two that drift.
 */
export function ProductEditPage() {
  return <ProductFormPage />;
}
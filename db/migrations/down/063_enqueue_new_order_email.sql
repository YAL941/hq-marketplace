-- destructive: false
REVOKE ALL ON FUNCTION public.enqueue_new_order_email(BIGINT) FROM PUBLIC;
DROP FUNCTION public.enqueue_new_order_email(BIGINT);

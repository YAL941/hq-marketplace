# Payments

## Flow
1. Customer places order (COD or provider).
2. Order created with payment_status=pending.
3. Provider webhook confirms payment -> payment_status=paid, commission calculated.

## Webhook verification
HMAC-SHA256 signature over raw body + timestamp. Mock provider uses x-mock-signature/x-mock-timestamp. Replay protection via timestamp window.

## Commission
- 5% on subtotal only (excluding delivery).
- merchant_amount = subtotal - commission (delivery goes fully to merchant).
- COD stays pending until real webhook provider added.

## Revenue metrics
- total_gmv: sum payment_amount_minor for paid payments.
- total_commission: sum commission_minor for paid payments.
- Both in minor units with currency.

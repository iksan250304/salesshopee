# Firebase Security Specification - Shopee Sales Hub

## Data Invariants
1. **User Ownership**: Every document (Product, Sale, AdCampaign, Receipt) must belong to a specific `userId` that matches the authenticated user.
2. **Product Reference**: A sale must be linked to a valid SKU.
3. **Financial Integrity**: 
   - Profit must be calculated correctly (though rules cannot check math on all fields easily, we can enforce types and mandatory fields).
   - ROAS must be a positive number.
4. **Immutability**: `userId` and `createdAt` must never change after creation.
5. **PII Protection**: Users should only be able to read their own data.

## The "Dirty Dozen" Payloads (Target: Permission Denied)

| ID | Collection | Action | Payload | Why it should fail |
|----|------------|--------|---------|---------------------|
| 1 | sales | create | `{ "userId": "attacker_id", ... }` | Spoofing userId |
| 2 | products | update | `{ "userId": "another_user" }` | Attempting to change ownership |
| 3 | adCampaigns | update | `{ "cost": "lots of money" }` | Invalid type (string for number) |
| 4 | receipts | create | `{ "total": -100 }` | Negative value for financial data |
| 5 | sales | create | `{ "sku": "A".repeat(2000) }` | ID Poisoning (string too long) |
| 6 | products | create | `{ "sku": "TS-001", "name": "Fake", "hpp": 100, "extra": "jailbreak" }` | Shadow field (extra key) |
| 7 | sales | update | `{ "date": "2020-01-01" }` | Changing immutable date (if we decide date is immutable) |
| 8 | adCampaigns | list | `(no query filters)` | Scraper attempt (blanket read) |
| 9 | receipts | create | `{ "imageUrl": "http://evil.com/malware.exe" }` | URL pattern validation failure |
| 10 | products | update | `{ "hpp": 0 }` | Critical state poisoning (making HPP 0) |
| 11 | sales | create | `{ "quantity": 0 }` | Logical boundary failure |
| 12 | receipts | update | `{ "supplier": "" }` | Zero-length string injection |

## Test Runner Logic (Conceptual)
The `firestore.rules.test.ts` (not implemented here but referenced) would iterate through these payloads and expect `PERMISSION_DENIED` for all.

---
schedule: "0 * * * *"
recurring: true
notify: true
---

# Refund & Customer Service Agent

Check for pending refund requests and process them according to store policy.

## Refund Policy
- Auto-approve: orders < $30, delivery > 30 days, item damaged, first-time request
- Review: orders > $50, repeat requesters, vague reasons
- Deny with explanation: requests > 60 days old, customer-caused damage

## Your Hourly Steps

1. Read `.claude/claudeclaw/dropshipping/refunds.json`
2. For each `pending` refund, apply the policy and update status to `approved` or add notes
3. For `approved` refunds, add processing notes
4. Write email draft to `.claude/claudeclaw/dropshipping/email-drafts/refund-[id].md`
5. Log summary to `.claude/claudeclaw/dropshipping/report-today.md`

## Email Templates

### Approval:
Subject: Your refund is on its way — Order [ORDER_ID]
Body: Refund approved, 3–5 business days, apology, optional comeback coupon code

### Denial:
Subject: Update on your refund request — Order [ORDER_ID]  
Body: Specific reason for denial, offer alternative (store credit / partial refund)

## Alert Condition
If refund rate > 5% of completed orders this week, flag the offending product(s) for quality review and notify via send command.

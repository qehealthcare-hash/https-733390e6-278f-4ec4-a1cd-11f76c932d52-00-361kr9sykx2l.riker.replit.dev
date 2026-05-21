# Folder Structure

```text
hominal-healthcare-crm/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   └── env.js
│   │   │   ├── lib/
│   │   │   │   ├── permissions.js
│   │   │   │   ├── storage.js
│   │   │   │   └── supabase.js
│   │   │   ├── middleware/
│   │   │   │   ├── auth.js
│   │   │   │   └── authorize.js
│   │   │   ├── routes/
│   │   │   │   ├── auth.routes.js
│   │   │   │   ├── patients.routes.js
│   │   │   │   ├── employees.routes.js
│   │   │   │   ├── inquiries.routes.js
│   │   │   │   ├── billings.routes.js
│   │   │   │   ├── payouts.routes.js
│   │   │   │   ├── reports.routes.js
│   │   │   │   ├── uploads.routes.js
│   │   │   │   └── lookups.routes.js
│   │   │   ├── services/
│   │   │   │   ├── dashboard.service.js
│   │   │   │   ├── billing.service.js
│   │   │   │   ├── payout.service.js
│   │   │   │   └── report.service.js
│   │   │   └── validators/
│   │   │       ├── patient.validator.js
│   │   │       ├── employee.validator.js
│   │   │       ├── inquiry.validator.js
│   │   │       ├── billing.validator.js
│   │   │       └── payout.validator.js
│   │   └── package.json
│   └── web/
│       ├── app/
│       │   ├── dashboard/
│       │   ├── patients/
│       │   ├── employees/
│       │   ├── inquiries/
│       │   ├── billings/
│       │   ├── payouts/
│       │   ├── reports/
│       │   ├── login/
│       │   ├── globals.css
│       │   └── layout.js
│       ├── components/
│       │   ├── layout/
│       │   ├── providers/
│       │   ├── state/
│       │   └── ui/
│       ├── hooks/
│       │   └── use-realtime-resource.js
│       └── lib/
│           ├── api-client.js
│           ├── permissions.js
│           ├── print.js
│           ├── uploads.js
│           └── crm-options.js
├── docs/
│   ├── API_STRUCTURE.md
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   ├── FOLDER_STRUCTURE.md
│   └── SETUP.md
└── supabase/
    ├── migrations/
    │   └── 001_initial_schema.sql
    └── seed/
        └── 001_sample_data.sql
```

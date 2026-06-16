<!-- Healthcare Data Readiness Desk - Databricks App with Lakebase -->

# Healthcare Data Readiness Desk

A Databricks App for profiling, auditing, and improving healthcare facility data. Built with AppKit, TypeScript, React, and Lakebase for persistent data storage.

## Setup Checklist

- [x] Project scaffolded with AppKit, TypeScript, React
- [x] Lakebase connection configured
- [ ] Install dependencies
- [ ] Initialize Lakebase schema
- [ ] Create and test API routes
- [ ] Build and deploy UI
- [ ] Deploy to Databricks Apps platform

## Project Structure

```
.
├── src/
│   ├── db/
│   │   ├── schema.ts         # Database schema setup
│   │   └── client.ts         # Lakebase connection
│   ├── api/
│   │   └── routes.ts         # CRUD API routes
│   ├── ui/
│   │   ├── App.tsx           # Main React component
│   │   └── components/       # UI components
│   └── index.ts              # Server entry point
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .env.example
└── README.md
```

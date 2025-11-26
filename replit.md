# Business Platform - Restaurant & Queue Management SaaS

## Overview

A full-stack multi-tenant SaaS platform offering two main modules:
1. **Restaurant Management**: QR code-based customer ordering with real-time updates across waiter, kitchen, cashier, and admin interfaces
2. **Queue Management**: Virtual ticketing system for businesses managing customer queues with real-time status updates

The platform supports subscription-based access with offline payment tracking, organization branding customization, and comprehensive analytics.

## Recent Changes

**November 26, 2025 (Latest)**: Multi-Module Organization Support
- Added "both" organization type allowing businesses to use Restaurant + Queue modules simultaneously
- Super Admin can now create new organizations with initial admin users (transactional with Zod validation)
- Updated subscription plan filtering: "both" type orgs see all plans, plans with "both" type visible to all org types
- Added subscription plans for "both" organization type (1, 3, 6, 12 month durations)
- Enhanced API with proper 409 conflict responses for uniqueness violations

**November 26, 2025**: SaaS Platform Enhancement Complete
- Added Super Admin Dashboard with plan management (1, 3, 6, 12 month durations), payment notes, and subscription history
- Implemented organization branding (logo upload, primary/secondary colors, business hours, description)
- Enhanced staff management with full CRUD, password reset, and active/inactive toggle
- Built Queue Management customer-facing page with QR-based join, virtual tickets, and real-time position updates
- Built Queue Management business dashboard with queue operations, call next, skip, and analytics
- Implemented subscription access control blocking expired subscriptions at login and on protected routes
- Added queue analytics with daily/weekly stats, peak hours, and average wait times
- WebSocket integration for real-time queue updates (ticket_created, ticket_called, queue_updated events)

## User Preferences

Preferred communication style: Simple, everyday language.

## Demo Accounts

- **Super Admin**: superadmin / superadmin123 (manages all organizations and subscriptions)
- **Org Admin**: demoadmin / demo123 (manages restaurant organization)
- **Staff**: waiter1, kitchen1, cashier1 / staff123 (staff roles)

## System Architecture

### Multi-Tenant Architecture
- **Organization Types**: `restaurant` (full restaurant management), `queue_business` (queue management only), or `both` (full access to both modules)
- **User Roles**: `super_admin` (platform owner), `org_admin` (organization admin), `org_staff` (staff members)
- **Subscription Model**: Plans with 1, 3, 6, 12 month durations; offline payment tracking with notes
- **Plan Visibility**: Plans marked "both" are visible to all org types; orgs with type "both" can see all plans

### Frontend Architecture
- **Frameworks**: React 18 with TypeScript, Vite, Wouter for routing, TanStack Query for server state
- **UI/UX**: Tailwind CSS and shadcn/ui (New York style), responsive design
- **Real-Time**: WebSocket at `/ws` for live updates, query invalidation on events
- **Key Pages**:
  - `/` - Login page
  - `/super-admin` - Super admin dashboard
  - `/admin` - Organization admin panel
  - `/queue-admin` - Queue management dashboard
  - `/queue/:qrCode` - Customer queue join page (public)

### Backend Architecture
- **Framework**: Express.js with Node.js, WebSocket server
- **API Design**: RESTful endpoints under `/api/*`, Zod validation
- **Authentication**: Session-based with bcrypt password hashing
- **Middleware**: `requireAuth`, `requireOrgAdmin`, `requireSuperAdmin`, `requireActiveSubscription`

### Database Schema (PostgreSQL/Drizzle ORM)
- **Core Tables**: organizations, users, subscriptionPlans, subscriptions
- **Restaurant Module**: tables, menuItems, orders, orderItems, payments, waiterCalls, reservations
- **Queue Module**: queues, queueTickets
- **Key Relations**: Organization → Users, Queues; Queue → Tickets; Subscription → Plan

### Key API Endpoints

**Super Admin:**
- `GET/POST/PATCH/DELETE /api/admin/plans` - Subscription plan management
- `GET/POST/PATCH/DELETE /api/admin/organizations` - Organization management
- `GET/POST/PATCH /api/admin/subscriptions` - Subscription management

**Organization Admin:**
- `GET/PATCH /api/org/settings` - Organization branding settings
- `GET /api/org/subscription` - View subscription status
- `GET/POST/PATCH/DELETE /api/users` - Staff management

**Queue Management:**
- `GET/POST/PATCH/DELETE /api/queues` - Queue CRUD
- `GET /api/queues/:id/tickets` - Queue tickets
- `POST /api/queues/:id/call-next` - Call next ticket
- `GET /api/queues/:id/analytics` - Queue analytics

**Public (No Auth):**
- `GET /api/public/queue/:qrCode` - Get queue info
- `POST /api/public/queue/:qrCode/join` - Join queue
- `GET /api/public/ticket/:ticketId` - Get ticket status

## External Dependencies

- **Database**: Neon Database (`@neondatabase/serverless`) for serverless PostgreSQL
- **UI Components**: shadcn/ui for Radix UI primitives with Tailwind styling
- **Charts**: recharts for analytics visualizations
- **Third-Party**: `qrcode` for QR generation, `date-fns` for date formatting, `bcrypt` for password hashing

## Development

```bash
npm run dev      # Start development server
npm run db:push  # Push schema changes to database
npm run db:seed  # Seed demo data
```

## Deployment

The application is configured for autoscale deployment:
- Build: `npm run build`
- Start: `npm run start`
- Port: 5000

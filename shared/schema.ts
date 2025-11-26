import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ==================== ORGANIZATIONS (Multi-tenant) ====================
export const organizations = sqliteTable("organizations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type", { enum: ["restaurant", "queue_business", "both"] }).notNull().default("restaurant"),
  email: text("email").notNull(),
  phone: text("phone"),
  address: text("address"),
  logoUrl: text("logo_url"),
  slogan: text("slogan"),
  primaryColor: text("primary_color").default("#8B5A2B"),
  secondaryColor: text("secondary_color").default("#FFF8E7"),
  businessHours: text("business_hours"),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  subscriptions: many(subscriptions),
  users: many(users),
  tables: many(tables),
  menuItems: many(menuItems),
  queues: many(queues),
}));

// ==================== SUBSCRIPTION PLANS ====================
export const subscriptionPlans = sqliteTable("subscription_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  durationMonths: integer("duration_months").notNull(),
  price: real("price").notNull(),
  features: text("features"),
  organizationType: text("organization_type", { enum: ["restaurant", "queue_business", "both"] }).notNull().default("restaurant"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  stripePriceId: text("stripe_price_id"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// ==================== SUBSCRIPTIONS ====================
export const subscriptions = sqliteTable("subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  planId: integer("plan_id").notNull().references(() => subscriptionPlans.id),
  status: text("status", { enum: ["active", "expired", "cancelled", "pending"] }).notNull().default("pending"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  autoRenew: integer("auto_renew", { mode: "boolean" }).notNull().default(false),
  paymentNotes: text("payment_notes"),
  paymentAmount: real("payment_amount"),
  paymentDate: text("payment_date"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  organization: one(organizations, {
    fields: [subscriptions.organizationId],
    references: [organizations.id],
  }),
  plan: one(subscriptionPlans, {
    fields: [subscriptions.planId],
    references: [subscriptionPlans.id],
  }),
}));

// ==================== QUEUE MANAGEMENT SYSTEM ====================
export const queues = sqliteTable("queues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status", { enum: ["active", "paused", "closed"] }).notNull().default("active"),
  currentTicket: integer("current_ticket").notNull().default(0),
  nextTicket: integer("next_ticket").notNull().default(1),
  avgServiceTime: integer("avg_service_time_minutes").notNull().default(5),
  qrCode: text("qr_code").notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const queuesRelations = relations(queues, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [queues.organizationId],
    references: [organizations.id],
  }),
  tickets: many(queueTickets),
}));

export const queueTickets = sqliteTable("queue_tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  queueId: integer("queue_id").notNull().references(() => queues.id),
  ticketNumber: integer("ticket_number").notNull(),
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  partySize: integer("party_size").notNull().default(1),
  status: text("status", { enum: ["waiting", "called", "serving", "completed", "cancelled", "no_show"] }).notNull().default("waiting"),
  estimatedWaitMinutes: integer("estimated_wait_minutes"),
  calledAt: text("called_at"),
  servedAt: text("served_at"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const queueTicketsRelations = relations(queueTickets, ({ one }) => ({
  queue: one(queues, {
    fields: [queueTickets.queueId],
    references: [queues.id],
  }),
}));

// ==================== RESTAURANT MANAGEMENT ====================
// Tables (Restaurant tables - scoped to organization)
export const tables = sqliteTable("tables", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: integer("organization_id").references(() => organizations.id),
  number: integer("number").notNull(),
  capacity: integer("capacity").notNull().default(4),
  status: text("status", { enum: ["free", "occupied", "reserved"] }).notNull().default("free"),
  qrCode: text("qr_code").notNull().unique(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const tablesRelations = relations(tables, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [tables.organizationId],
    references: [organizations.id],
  }),
  orders: many(orders),
  payments: many(payments),
}));

// Menu Items (scoped to organization)
export const menuItems = sqliteTable("menu_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: integer("organization_id").references(() => organizations.id),
  name: text("name").notNull(),
  category: text("category", { enum: ["appetizers", "mains", "drinks", "desserts", "specials"] }).notNull(),
  price: real("price").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url").notNull(),
  available: integer("available", { mode: "boolean" }).notNull().default(true),
  preparationTimeMinutes: integer("preparation_time_minutes").notNull().default(15),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const menuItemsRelations = relations(menuItems, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [menuItems.organizationId],
    references: [organizations.id],
  }),
  orderItems: many(orderItems),
}));

// Orders
export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tableId: integer("table_id").notNull().references(() => tables.id),
  status: text("status", { enum: ["pending", "confirmed", "completed", "cancelled"] }).notNull().default("pending"),
  total: real("total").notNull().default(0.00),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const ordersRelations = relations(orders, ({ one, many }) => ({
  table: one(tables, {
    fields: [orders.tableId],
    references: [tables.id],
  }),
  orderItems: many(orderItems),
  payment: one(payments),
}));

// Order Items
export const orderItems = sqliteTable("order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => orders.id),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItems.id),
  quantity: integer("quantity").notNull().default(1),
  notes: text("notes"),
  status: text("status", { enum: ["queued", "preparing", "almost_ready", "ready", "delivered", "cancelled"] }).notNull().default("queued"),
  price: real("price").notNull(),
  startedPreparingAt: text("started_preparing_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  menuItem: one(menuItems, {
    fields: [orderItems.menuItemId],
    references: [menuItems.id],
  }),
}));

// Users (with organization scope and global role)
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organizationId: integer("organization_id").references(() => organizations.id),
  username: text("username").notNull().unique(),
  email: text("email"),
  password: text("password").notNull(),
  globalRole: text("global_role", { enum: ["super_admin", "org_admin", "org_staff"] }).notNull().default("org_staff"),
  role: text("role", { enum: ["admin", "waiter", "kitchen", "cashier"] }).notNull(),
  name: text("name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
}));

// Payments
export const payments = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull().references(() => orders.id).unique(),
  tableId: integer("table_id").notNull().references(() => tables.id),
  amount: real("amount").notNull(),
  method: text("method", { enum: ["cash", "card"] }).notNull(),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, {
    fields: [payments.orderId],
    references: [orders.id],
  }),
  table: one(tables, {
    fields: [payments.tableId],
    references: [tables.id],
  }),
}));

// Waiter Call Notifications
export const waiterCalls = sqliteTable("waiter_calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tableId: integer("table_id").notNull().references(() => tables.id),
  reason: text("reason"),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// Bill Shares for split bills
export const billShares = sqliteTable("bill_shares", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  paymentId: integer("payment_id").notNull().references(() => payments.id),
  customerName: text("customer_name").notNull(),
  amount: real("amount").notNull(),
  paid: integer("paid", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// Reservations
export const reservations = sqliteTable("reservations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tableId: integer("table_id").notNull().references(() => tables.id),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone"),
  guestCount: integer("guest_count").notNull(),
  reservationTime: text("reservation_time").notNull(),
  status: text("status", { enum: ["confirmed", "cancelled", "completed"] }).notNull().default("confirmed"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// Dish Reviews/Ratings
export const dishReviews = sqliteTable("dish_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  menuItemId: integer("menu_item_id").notNull().references(() => menuItems.id),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  customerName: text("customer_name"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// ==================== INSERT SCHEMAS ====================

// Organization & Subscription Insert Schemas
export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true as any,
  createdAt: true as any,
  updatedAt: true as any,
});

export const insertSubscriptionPlanSchema = createInsertSchema(subscriptionPlans).omit({
  id: true as any,
  createdAt: true as any,
});

export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({
  id: true as any,
  createdAt: true as any,
  updatedAt: true as any,
});

// Queue Management Insert Schemas
export const insertQueueSchema = createInsertSchema(queues).omit({
  id: true as any,
  createdAt: true as any,
  updatedAt: true as any,
});

export const insertQueueTicketSchema = createInsertSchema(queueTickets).omit({
  id: true as any,
  createdAt: true as any,
});

// Restaurant Insert Schemas
export const insertTableSchema = createInsertSchema(tables).omit({
  id: true as any,
  createdAt: true as any,
});

export const insertMenuItemSchema = createInsertSchema(menuItems).omit({
  id: true as any,
  createdAt: true as any,
}).extend({
  preparationTimeMinutes: z.number().int().positive().optional(),
});

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true as any,
  createdAt: true as any,
  updatedAt: true as any,
});

export const insertOrderItemSchema = createInsertSchema(orderItems).omit({
  id: true as any,
  createdAt: true as any,
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true as any,
  createdAt: true as any,
});

export const insertPaymentSchema = createInsertSchema(payments).omit({
  id: true as any,
  createdAt: true as any,
});

export const insertWaiterCallSchema = createInsertSchema(waiterCalls).omit({
  id: true as any,
  createdAt: true as any,
});

export const insertBillShareSchema = createInsertSchema(billShares).omit({
  id: true as any,
  createdAt: true as any,
});

export const insertReservationSchema = createInsertSchema(reservations).omit({
  id: true as any,
  createdAt: true as any,
});

export const insertDishReviewSchema = createInsertSchema(dishReviews).omit({
  id: true as any,
  createdAt: true as any,
});

// Types
export type Table = typeof tables.$inferSelect;
export type InsertTable = z.infer<typeof insertTableSchema>;

export type MenuItem = typeof menuItems.$inferSelect;
export type InsertMenuItem = z.infer<typeof insertMenuItemSchema>;

export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;

export type WaiterCall = typeof waiterCalls.$inferSelect;
export type InsertWaiterCall = z.infer<typeof insertWaiterCallSchema>;

export type BillShare = typeof billShares.$inferSelect;
export type InsertBillShare = z.infer<typeof insertBillShareSchema>;

export type Reservation = typeof reservations.$inferSelect;
export type InsertReservation = z.infer<typeof insertReservationSchema>;

export type DishReview = typeof dishReviews.$inferSelect;
export type InsertDishReview = z.infer<typeof insertDishReviewSchema>;

// Organization & Subscription Types
export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;

export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type InsertSubscriptionPlan = z.infer<typeof insertSubscriptionPlanSchema>;

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;

// Queue Management Types
export type Queue = typeof queues.$inferSelect;
export type InsertQueue = z.infer<typeof insertQueueSchema>;

export type QueueTicket = typeof queueTickets.$inferSelect;
export type InsertQueueTicket = z.infer<typeof insertQueueTicketSchema>;

// Extended types with relations
export type OrderWithItems = Order & {
  orderItems: (OrderItem & {
    menuItem: MenuItem;
  })[];
  table: Table;
};

export type TableWithOrders = Table & {
  orders: OrderWithItems[];
};

export type OrganizationWithSubscription = Organization & {
  subscriptions: (Subscription & {
    plan: SubscriptionPlan;
  })[];
};

export type QueueWithTickets = Queue & {
  tickets: QueueTicket[];
  organization: Organization;
};

// API routes and WebSocket server from javascript_websocket blueprint
import type { Express } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import multer from "multer";
import path from "path";
import { storage } from "./storage";
import { db } from "./db";
import { 
  insertMenuItemSchema, insertTableSchema, insertUserSchema, insertOrderSchema, 
  insertOrderItemSchema, insertPaymentSchema, insertWaiterCallSchema, insertBillShareSchema, 
  insertReservationSchema, insertDishReviewSchema, insertOrganizationSchema, 
  insertSubscriptionPlanSchema, insertSubscriptionSchema, insertQueueSchema, insertQueueTicketSchema,
  payments, billShares, orders, tables, users, organizations, subscriptions, subscriptionPlans,
  queues, queueTickets
} from "@shared/schema";
import { eq, and, gte, lt, desc, asc, sql } from "drizzle-orm";
import { 
  hashPassword, verifyPassword, authenticateUser, 
  requireAuth, requireAuthWithSubscription, requireSuperAdmin, requireOrgAdmin, requireActiveSubscription,
  getActiveSubscription, checkSubscriptionActive
} from "./auth";
import { z } from "zod";
import QRCode from 'qrcode';

// Configure multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, path.join(process.cwd(), "client/public/uploads"));
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  }
});

// WebSocket clients tracking
const clients = new Set<WebSocket>();

// Broadcast to all connected clients
function broadcast(message: any) {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  
  // Serve static files from attached_assets before Vite middleware
  app.use("/attached_assets", express.static(path.join(process.cwd(), "attached_assets")));

  // WebSocket server on a distinct path to avoid conflicts with Vite HMR
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on("connection", (ws) => {
    clients.add(ws);
    console.log("WebSocket client connected");

    ws.on("close", () => {
      clients.delete(ws);
      console.log("WebSocket client disconnected");
    });

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
      clients.delete(ws);
    });
  });

  // ========== AUTHENTICATION ENDPOINTS ==========
  
  // Login endpoint
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      const user = await authenticateUser(username, password);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (!user.isActive) {
        return res.status(403).json({ error: "Account is disabled" });
      }

      // Check subscription for org users
      if (user.globalRole !== "super_admin" && user.organizationId) {
        const hasSubscription = await checkSubscriptionActive(user.organizationId);
        if (!hasSubscription) {
          return res.status(403).json({ 
            error: "Subscription expired",
            code: "SUBSCRIPTION_EXPIRED",
            message: "Your organization's subscription has expired. Please contact the owner to renew."
          });
        }
      }

      // Get organization details if applicable
      let organization = null;
      if (user.organizationId) {
        organization = await db.query.organizations.findFirst({
          where: eq(organizations.id, user.organizationId),
        });
      }

      // Set session
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.globalRole = user.globalRole;
      req.session.role = user.role;
      req.session.organizationId = user.organizationId;
      req.session.organizationType = organization?.type || null;

      res.json({
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          globalRole: user.globalRole,
          role: user.role,
          email: user.email,
        },
        organization: organization ? {
          id: organization.id,
          name: organization.name,
          type: organization.type,
          logoUrl: organization.logoUrl,
        } : null,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Logout endpoint
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Failed to logout" });
      }
      res.json({ message: "Logged out successfully" });
    });
  });

  // Get current session
  app.get("/api/auth/session", async (req, res) => {
    if (!req.session?.userId) {
      return res.json({ authenticated: false });
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, req.session.userId),
    });

    if (!user) {
      return res.json({ authenticated: false });
    }

    let organization = null;
    if (user.organizationId) {
      organization = await db.query.organizations.findFirst({
        where: eq(organizations.id, user.organizationId),
      });
    }

    res.json({
      authenticated: true,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        globalRole: user.globalRole,
        role: user.role,
        email: user.email,
      },
      organization: organization ? {
        id: organization.id,
        name: organization.name,
        type: organization.type,
        logoUrl: organization.logoUrl,
      } : null,
    });
  });

  // Register new organization (for new restaurant owners)
  app.post("/api/auth/register", async (req, res) => {
    try {
      const registerSchema = z.object({
        organizationName: z.string().min(2),
        organizationType: z.enum(["restaurant", "queue_business"]),
        email: z.string().email(),
        phone: z.string().optional(),
        username: z.string().min(3),
        password: z.string().min(6),
        name: z.string().min(2),
      });

      const data = registerSchema.parse(req.body);

      // Check if username exists
      const existingUser = await db.query.users.findFirst({
        where: eq(users.username, data.username),
      });
      if (existingUser) {
        return res.status(400).json({ error: "Username already taken" });
      }

      // Create organization
      const slug = data.organizationName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
      const [org] = await db.insert(organizations).values({
        name: data.organizationName,
        slug: slug + "-" + Date.now(),
        type: data.organizationType,
        email: data.email,
        phone: data.phone,
        isActive: true,
      }).returning();

      // Create admin user with hashed password
      const hashedPassword = await hashPassword(data.password);
      const [user] = await db.insert(users).values({
        organizationId: org.id,
        username: data.username,
        email: data.email,
        password: hashedPassword,
        globalRole: "org_admin",
        role: "admin",
        name: data.name,
        isActive: true,
      }).returning();

      res.status(201).json({
        message: "Organization registered successfully. Please purchase a subscription to activate your account.",
        organization: { id: org.id, name: org.name, type: org.type },
        user: { id: user.id, username: user.username, name: user.name },
      });
    } catch (error: any) {
      if (error.code === "23505") {
        return res.status(400).json({ error: "Organization or user already exists" });
      }
      res.status(400).json({ error: error.message });
    }
  });

  // ========== SUPER ADMIN ENDPOINTS ==========

  // Get all organizations (Super Admin only)
  app.get("/api/admin/organizations", requireSuperAdmin, async (req, res) => {
    try {
      const orgs = await db.query.organizations.findMany({
        with: {
          subscriptions: {
            with: { plan: true },
            orderBy: desc(subscriptions.endDate),
            limit: 1,
          },
        },
        orderBy: desc(organizations.createdAt),
      });

      const orgsWithStatus = orgs.map(org => {
        const latestSub = org.subscriptions[0];
        const now = new Date();
        const isActive = latestSub && 
          latestSub.status === "active" && 
          new Date(latestSub.endDate) > now;

        return {
          ...org,
          subscriptionStatus: isActive ? "active" : "expired",
          currentPlan: latestSub?.plan || null,
          expiresAt: latestSub?.endDate || null,
          daysRemaining: latestSub && isActive
            ? Math.ceil((new Date(latestSub.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            : 0,
        };
      });

      res.json(orgsWithStatus);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get subscription plans (Super Admin)
  app.get("/api/admin/plans", requireSuperAdmin, async (req, res) => {
    try {
      const plans = await db.query.subscriptionPlans.findMany({
        orderBy: [subscriptionPlans.organizationType, subscriptionPlans.durationMonths],
      });
      res.json(plans);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create subscription plan (Super Admin)
  app.post("/api/admin/plans", requireSuperAdmin, async (req, res) => {
    try {
      const data = insertSubscriptionPlanSchema.parse(req.body);
      const [plan] = await db.insert(subscriptionPlans).values(data).returning();
      res.status(201).json(plan);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Update subscription plan (Super Admin)
  app.patch("/api/admin/plans/:id", requireSuperAdmin, async (req, res) => {
    try {
      const planId = parseInt(req.params.id);
      const { name, description, durationMonths, price, features, organizationType, isActive } = req.body;
      
      const [updatedPlan] = await db.update(subscriptionPlans)
        .set({
          ...(name && { name }),
          ...(description !== undefined && { description }),
          ...(durationMonths && { durationMonths }),
          ...(price && { price }),
          ...(features !== undefined && { features }),
          ...(organizationType && { organizationType }),
          ...(isActive !== undefined && { isActive }),
        })
        .where(eq(subscriptionPlans.id, planId))
        .returning();
      
      if (!updatedPlan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      
      res.json(updatedPlan);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Delete/deactivate subscription plan (Super Admin)
  app.delete("/api/admin/plans/:id", requireSuperAdmin, async (req, res) => {
    try {
      const planId = parseInt(req.params.id);
      
      const [deactivatedPlan] = await db.update(subscriptionPlans)
        .set({ isActive: false })
        .where(eq(subscriptionPlans.id, planId))
        .returning();
      
      if (!deactivatedPlan) {
        return res.status(404).json({ error: "Plan not found" });
      }
      
      res.json({ message: "Plan deactivated successfully", plan: deactivatedPlan });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create organization with admin user (Super Admin)
  app.post("/api/admin/organizations", requireSuperAdmin, async (req, res) => {
    try {
      const createOrgSchema = z.object({
        name: z.string().min(1, "Business name is required"),
        email: z.string().email("Valid email is required"),
        phone: z.string().optional(),
        address: z.string().optional(),
        type: z.enum(["restaurant", "queue_business", "both"]),
        adminUsername: z.string().min(3, "Username must be at least 3 characters"),
        adminPassword: z.string().min(6, "Password must be at least 6 characters"),
        adminName: z.string().min(1, "Admin name is required"),
        adminEmail: z.string().email().optional(),
      });

      const validatedData = createOrgSchema.parse(req.body);
      const { name, email, phone, address, type, adminUsername, adminPassword, adminName, adminEmail } = validatedData;

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

      const existingOrg = await db.query.organizations.findFirst({
        where: eq(organizations.slug, slug),
      });

      if (existingOrg) {
        return res.status(409).json({ error: "An organization with this name already exists" });
      }

      const existingUser = await db.query.users.findFirst({
        where: eq(users.username, adminUsername),
      });

      if (existingUser) {
        return res.status(409).json({ error: "Username already taken" });
      }

      const hashedPassword = await hashPassword(adminPassword);

      const result = await db.transaction(async (tx) => {
        const [newOrg] = await tx.insert(organizations).values({
          name,
          slug,
          type,
          email,
          phone: phone || null,
          address: address || null,
          isActive: true,
        }).returning();

        const [newAdmin] = await tx.insert(users).values({
          organizationId: newOrg.id,
          username: adminUsername,
          email: adminEmail || email,
          password: hashedPassword,
          globalRole: "org_admin",
          role: "admin",
          name: adminName,
          isActive: true,
        }).returning();

        return { organization: newOrg, admin: newAdmin };
      });

      broadcast({ type: "organization_created", data: result.organization });
      
      res.status(201).json({ 
        organization: result.organization,
        admin: {
          id: result.admin.id,
          username: result.admin.username,
          name: result.admin.name,
          email: result.admin.email,
        }
      });
    } catch (error: any) {
      if (error.name === 'ZodError') {
        return res.status(400).json({ error: error.errors[0]?.message || "Validation failed" });
      }
      res.status(400).json({ error: error.message });
    }
  });

  // Update organization (Super Admin) - toggle active status, etc.
  app.patch("/api/admin/organizations/:id", requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseInt(req.params.id);
      const { isActive, name, email, phone, address } = req.body;
      
      const [updatedOrg] = await db.update(organizations)
        .set({
          ...(isActive !== undefined && { isActive }),
          ...(name && { name }),
          ...(email && { email }),
          ...(phone !== undefined && { phone }),
          ...(address !== undefined && { address }),
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, orgId))
        .returning();
      
      if (!updatedOrg) {
        return res.status(404).json({ error: "Organization not found" });
      }
      
      broadcast({ type: "organization_updated", data: updatedOrg });
      res.json(updatedOrg);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Get subscription history for an organization (Super Admin)
  app.get("/api/admin/organizations/:id/subscriptions", requireSuperAdmin, async (req, res) => {
    try {
      const orgId = parseInt(req.params.id);
      
      const subs = await db.query.subscriptions.findMany({
        where: eq(subscriptions.organizationId, orgId),
        with: {
          plan: true,
        },
        orderBy: desc(subscriptions.createdAt),
      });
      
      res.json(subs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Manually add/extend subscription (Super Admin)
  app.post("/api/admin/subscriptions", requireSuperAdmin, async (req, res) => {
    try {
      const { organizationId, planId, startDate, paymentNotes, paymentAmount } = req.body;
      
      const plan = await db.query.subscriptionPlans.findFirst({
        where: eq(subscriptionPlans.id, planId),
      });
      
      if (!plan) {
        return res.status(404).json({ error: "Plan not found" });
      }

      const start = startDate ? new Date(startDate) : new Date();
      const end = new Date(start);
      end.setMonth(end.getMonth() + plan.durationMonths);

      const [subscription] = await db.insert(subscriptions).values({
        organizationId,
        planId,
        status: "active",
        startDate: start,
        endDate: end,
        autoRenew: false,
        paymentNotes: paymentNotes || null,
        paymentAmount: paymentAmount || plan.price,
        paymentDate: new Date(),
      }).returning();

      broadcast({ type: "subscription_updated", data: { organizationId } });
      res.status(201).json(subscription);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Get all subscriptions (Super Admin)
  app.get("/api/admin/subscriptions", requireSuperAdmin, async (req, res) => {
    try {
      const subs = await db.query.subscriptions.findMany({
        with: {
          organization: true,
          plan: true,
        },
        orderBy: desc(subscriptions.createdAt),
      });
      res.json(subs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get dashboard stats (Super Admin)
  app.get("/api/admin/stats", requireSuperAdmin, async (req, res) => {
    try {
      const now = new Date();
      
      const totalOrgs = await db.select({ count: sql<number>`count(*)` }).from(organizations);
      const activeSubscriptions = await db.select({ count: sql<number>`count(*)` })
        .from(subscriptions)
        .where(and(eq(subscriptions.status, "active"), gte(subscriptions.endDate, now)));
      
      const expiringSoon = await db.select({ count: sql<number>`count(*)` })
        .from(subscriptions)
        .where(and(
          eq(subscriptions.status, "active"),
          gte(subscriptions.endDate, now),
          sql`${subscriptions.endDate} <= ${new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)}`
        ));

      res.json({
        totalOrganizations: Number(totalOrgs[0]?.count || 0),
        activeSubscriptions: Number(activeSubscriptions[0]?.count || 0),
        expiringSoon: Number(expiringSoon[0]?.count || 0),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== ORGANIZATION SETTINGS (Org Admin) ==========
  
  // Get current organization settings
  app.get("/api/org/settings", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }
      
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
      });
      
      if (!org) {
        return res.status(404).json({ error: "Organization not found" });
      }
      
      res.json(org);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Update organization settings
  app.patch("/api/org/settings", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }
      
      const { name, phone, address, logoUrl, slogan, primaryColor, secondaryColor, businessHours, description } = req.body;
      
      const [updatedOrg] = await db.update(organizations)
        .set({
          ...(name && { name }),
          ...(phone !== undefined && { phone }),
          ...(address !== undefined && { address }),
          ...(logoUrl !== undefined && { logoUrl }),
          ...(slogan !== undefined && { slogan }),
          ...(primaryColor !== undefined && { primaryColor }),
          ...(secondaryColor !== undefined && { secondaryColor }),
          ...(businessHours !== undefined && { businessHours }),
          ...(description !== undefined && { description }),
          updatedAt: new Date(),
        })
        .where(eq(organizations.id, orgId))
        .returning();
      
      if (!updatedOrg) {
        return res.status(404).json({ error: "Organization not found" });
      }
      
      broadcast({ type: "organization_updated", data: updatedOrg });
      res.json(updatedOrg);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });
  
  // Get current subscription status for org admin
  app.get("/api/org/subscription", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }
      
      const subscription = await getActiveSubscription(orgId);
      
      if (!subscription) {
        return res.json({
          hasActiveSubscription: false,
          message: "No active subscription. Please contact the app owner to renew.",
          contactEmail: "support@businessplatform.com",
        });
      }
      
      const now = new Date();
      const daysRemaining = Math.ceil(
        (new Date(subscription.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      res.json({
        hasActiveSubscription: true,
        subscription: {
          id: subscription.id,
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          daysRemaining,
          plan: subscription.plan,
        },
        message: daysRemaining <= 7 
          ? `Your subscription expires in ${daysRemaining} days. Please contact the app owner to renew.`
          : null,
        contactEmail: "support@businessplatform.com",
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== QUEUE MANAGEMENT ENDPOINTS ==========

  // Get all queues for the organization
  app.get("/api/queues", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }

      const queueList = await db.query.queues.findMany({
        where: eq(queues.organizationId, orgId),
        orderBy: desc(queues.createdAt),
      });

      res.json(queueList);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new queue
  app.post("/api/queues", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }

      const data = insertQueueSchema.parse({
        ...req.body,
        organizationId: orgId,
        qrCode: `queue-${orgId}-temp-${Date.now()}`,
      });

      const [queue] = await db.insert(queues).values(data).returning();

      // Generate unique QR code with queue ID
      const qrCodeString = `queue-${orgId}-${queue.id}-${Date.now()}`;
      const [updatedQueue] = await db.update(queues)
        .set({ qrCode: qrCodeString })
        .where(eq(queues.id, queue.id))
        .returning();

      // Generate QR code image as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(qrCodeString);

      broadcast({ type: "queue_updated", data: updatedQueue });
      res.status(201).json({ ...updatedQueue, qrCodeImage: qrCodeDataUrl });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Update queue settings
  app.patch("/api/queues/:id", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }

      const queueId = parseInt(req.params.id);
      const { name, description, status, avgServiceTime } = req.body;

      const [updatedQueue] = await db.update(queues)
        .set({
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(status !== undefined && { status }),
          ...(avgServiceTime !== undefined && { avgServiceTime }),
          updatedAt: new Date(),
        })
        .where(and(eq(queues.id, queueId), eq(queues.organizationId, orgId)))
        .returning();

      if (!updatedQueue) {
        return res.status(404).json({ error: "Queue not found" });
      }

      broadcast({ type: "queue_updated", data: updatedQueue });
      res.json(updatedQueue);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Delete a queue
  app.delete("/api/queues/:id", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }

      const queueId = parseInt(req.params.id);

      // First delete all tickets in the queue
      await db.delete(queueTickets).where(eq(queueTickets.queueId, queueId));

      // Then delete the queue
      const [deletedQueue] = await db.delete(queues)
        .where(and(eq(queues.id, queueId), eq(queues.organizationId, orgId)))
        .returning();

      if (!deletedQueue) {
        return res.status(404).json({ error: "Queue not found" });
      }

      broadcast({ type: "queue_updated", data: { id: queueId, deleted: true } });
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get queue details with current status
  app.get("/api/queues/:id", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }

      const queueId = parseInt(req.params.id);

      const queue = await db.query.queues.findFirst({
        where: and(eq(queues.id, queueId), eq(queues.organizationId, orgId)),
      });

      if (!queue) {
        return res.status(404).json({ error: "Queue not found" });
      }

      // Get waiting ticket count
      const waitingTickets = await db.select({ count: sql<number>`count(*)` })
        .from(queueTickets)
        .where(and(eq(queueTickets.queueId, queueId), eq(queueTickets.status, "waiting")));

      // Generate QR code image
      const qrCodeDataUrl = await QRCode.toDataURL(queue.qrCode);

      res.json({
        ...queue,
        waitingCount: Number(waitingTickets[0]?.count || 0),
        qrCodeImage: qrCodeDataUrl,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== QUEUE TICKET MANAGEMENT ENDPOINTS ==========

  // Get all tickets for a queue (optionally filter by status)
  app.get("/api/queues/:id/tickets", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }

      const queueId = parseInt(req.params.id);
      const statusFilter = req.query.status as string | undefined;

      // Verify queue belongs to organization
      const queue = await db.query.queues.findFirst({
        where: and(eq(queues.id, queueId), eq(queues.organizationId, orgId)),
      });

      if (!queue) {
        return res.status(404).json({ error: "Queue not found" });
      }

      let ticketQuery;
      if (statusFilter) {
        ticketQuery = await db.query.queueTickets.findMany({
          where: and(eq(queueTickets.queueId, queueId), eq(queueTickets.status, statusFilter as any)),
          orderBy: asc(queueTickets.ticketNumber),
        });
      } else {
        ticketQuery = await db.query.queueTickets.findMany({
          where: eq(queueTickets.queueId, queueId),
          orderBy: asc(queueTickets.ticketNumber),
        });
      }

      res.json(ticketQuery);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update ticket status
  app.patch("/api/queues/:queueId/tickets/:ticketId/status", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }

      const queueId = parseInt(req.params.queueId);
      const ticketId = parseInt(req.params.ticketId);
      const { status } = req.body;

      // Verify queue belongs to organization
      const queue = await db.query.queues.findFirst({
        where: and(eq(queues.id, queueId), eq(queues.organizationId, orgId)),
      });

      if (!queue) {
        return res.status(404).json({ error: "Queue not found" });
      }

      const updateData: any = { status };
      if (status === "called") {
        updateData.calledAt = new Date();
      } else if (status === "serving") {
        updateData.servedAt = new Date();
      } else if (status === "completed") {
        updateData.completedAt = new Date();
      }

      const [updatedTicket] = await db.update(queueTickets)
        .set(updateData)
        .where(and(eq(queueTickets.id, ticketId), eq(queueTickets.queueId, queueId)))
        .returning();

      if (!updatedTicket) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      broadcast({ type: "ticket_status_updated", data: updatedTicket });
      res.json(updatedTicket);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Call the next ticket
  app.post("/api/queues/:id/call-next", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }

      const queueId = parseInt(req.params.id);

      // Verify queue belongs to organization and get current state
      const queue = await db.query.queues.findFirst({
        where: and(eq(queues.id, queueId), eq(queues.organizationId, orgId)),
      });

      if (!queue) {
        return res.status(404).json({ error: "Queue not found" });
      }

      // Find the next waiting ticket (lowest ticket number with status = waiting)
      const nextTicket = await db.query.queueTickets.findFirst({
        where: and(eq(queueTickets.queueId, queueId), eq(queueTickets.status, "waiting")),
        orderBy: asc(queueTickets.ticketNumber),
      });

      if (!nextTicket) {
        return res.status(404).json({ error: "No waiting tickets in queue" });
      }

      // Update ticket status to called
      const [calledTicket] = await db.update(queueTickets)
        .set({ status: "called", calledAt: new Date() })
        .where(eq(queueTickets.id, nextTicket.id))
        .returning();

      // Update queue's current ticket number
      await db.update(queues)
        .set({ currentTicket: nextTicket.ticketNumber, updatedAt: new Date() })
        .where(eq(queues.id, queueId));

      broadcast({ type: "ticket_called", data: calledTicket });
      res.json(calledTicket);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Skip a ticket (mark as no_show)
  app.post("/api/queues/:id/skip/:ticketId", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }

      const queueId = parseInt(req.params.id);
      const ticketId = parseInt(req.params.ticketId);

      // Verify queue belongs to organization
      const queue = await db.query.queues.findFirst({
        where: and(eq(queues.id, queueId), eq(queues.organizationId, orgId)),
      });

      if (!queue) {
        return res.status(404).json({ error: "Queue not found" });
      }

      const [skippedTicket] = await db.update(queueTickets)
        .set({ status: "no_show" })
        .where(and(eq(queueTickets.id, ticketId), eq(queueTickets.queueId, queueId)))
        .returning();

      if (!skippedTicket) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      broadcast({ type: "ticket_status_updated", data: skippedTicket });
      res.json(skippedTicket);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Remove/cancel a ticket
  app.delete("/api/queues/:id/tickets/:ticketId", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }

      const queueId = parseInt(req.params.id);
      const ticketId = parseInt(req.params.ticketId);

      // Verify queue belongs to organization
      const queue = await db.query.queues.findFirst({
        where: and(eq(queues.id, queueId), eq(queues.organizationId, orgId)),
      });

      if (!queue) {
        return res.status(404).json({ error: "Queue not found" });
      }

      const [deletedTicket] = await db.delete(queueTickets)
        .where(and(eq(queueTickets.id, ticketId), eq(queueTickets.queueId, queueId)))
        .returning();

      if (!deletedTicket) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      broadcast({ type: "ticket_status_updated", data: { id: ticketId, deleted: true } });
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== PUBLIC QUEUE ENDPOINTS ==========

  // Get queue info by QR code (for customer join page)
  app.get("/api/public/queue/:qrCode", async (req, res) => {
    try {
      const qrCode = req.params.qrCode;

      const queue = await db.query.queues.findFirst({
        where: eq(queues.qrCode, qrCode),
        with: {
          organization: true,
        },
      });

      if (!queue) {
        return res.status(404).json({ error: "Queue not found" });
      }

      if (queue.status === "closed") {
        return res.status(400).json({ error: "This queue is currently closed" });
      }

      // Get waiting ticket count
      const waitingTickets = await db.select({ count: sql<number>`count(*)` })
        .from(queueTickets)
        .where(and(eq(queueTickets.queueId, queue.id), eq(queueTickets.status, "waiting")));

      const waitingCount = Number(waitingTickets[0]?.count || 0);
      const estimatedWaitMinutes = waitingCount * queue.avgServiceTime;

      res.json({
        id: queue.id,
        name: queue.name,
        description: queue.description,
        status: queue.status,
        avgServiceTime: queue.avgServiceTime,
        waitingCount,
        estimatedWaitMinutes,
        organization: {
          name: queue.organization.name,
          logoUrl: queue.organization.logoUrl,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Join queue (create ticket)
  app.post("/api/public/queue/:qrCode/join", async (req, res) => {
    try {
      const qrCode = req.params.qrCode;
      const { customerName, customerPhone, partySize } = req.body;

      const queue = await db.query.queues.findFirst({
        where: eq(queues.qrCode, qrCode),
      });

      if (!queue) {
        return res.status(404).json({ error: "Queue not found" });
      }

      if (queue.status === "closed") {
        return res.status(400).json({ error: "This queue is currently closed" });
      }

      if (queue.status === "paused") {
        return res.status(400).json({ error: "This queue is currently paused and not accepting new entries" });
      }

      // Get the next ticket number and increment
      const ticketNumber = queue.nextTicket;
      await db.update(queues)
        .set({ nextTicket: ticketNumber + 1, updatedAt: new Date() })
        .where(eq(queues.id, queue.id));

      // Calculate position and estimated wait
      const waitingTickets = await db.select({ count: sql<number>`count(*)` })
        .from(queueTickets)
        .where(and(eq(queueTickets.queueId, queue.id), eq(queueTickets.status, "waiting")));

      const position = Number(waitingTickets[0]?.count || 0) + 1;
      const estimatedWaitMinutes = position * queue.avgServiceTime;

      // Create the ticket
      const ticketData = insertQueueTicketSchema.parse({
        queueId: queue.id,
        ticketNumber,
        customerName: customerName || null,
        customerPhone: customerPhone || null,
        partySize: partySize || 1,
        status: "waiting",
        estimatedWaitMinutes,
      });

      const [ticket] = await db.insert(queueTickets).values(ticketData).returning();

      broadcast({ type: "ticket_created", data: ticket });
      res.status(201).json({
        ...ticket,
        position,
        estimatedWaitMinutes,
        queueName: queue.name,
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Get ticket status and position (for customer tracking)
  app.get("/api/public/ticket/:ticketId", async (req, res) => {
    try {
      const ticketId = parseInt(req.params.ticketId);

      const ticket = await db.query.queueTickets.findFirst({
        where: eq(queueTickets.id, ticketId),
        with: {
          queue: {
            with: {
              organization: true,
            },
          },
        },
      });

      if (!ticket) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      // Calculate position (tickets ahead with status = waiting and ticketNumber < this ticket)
      let position = 0;
      let estimatedWaitMinutes = 0;

      if (ticket.status === "waiting") {
        const ticketsAhead = await db.select({ count: sql<number>`count(*)` })
          .from(queueTickets)
          .where(and(
            eq(queueTickets.queueId, ticket.queueId),
            eq(queueTickets.status, "waiting"),
            lt(queueTickets.ticketNumber, ticket.ticketNumber)
          ));

        position = Number(ticketsAhead[0]?.count || 0) + 1;
        estimatedWaitMinutes = position * ticket.queue.avgServiceTime;
      }

      res.json({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        customerName: ticket.customerName,
        partySize: ticket.partySize,
        position,
        estimatedWaitMinutes,
        calledAt: ticket.calledAt,
        createdAt: ticket.createdAt,
        queue: {
          name: ticket.queue.name,
          status: ticket.queue.status,
          currentTicket: ticket.queue.currentTicket,
        },
        organization: {
          name: ticket.queue.organization.name,
          logoUrl: ticket.queue.organization.logoUrl,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== QUEUE ANALYTICS ENDPOINTS ==========

  // Get analytics for a specific queue
  app.get("/api/queues/:id/analytics", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }

      const queueId = parseInt(req.params.id);

      // Verify queue belongs to organization
      const queue = await db.query.queues.findFirst({
        where: and(eq(queues.id, queueId), eq(queues.organizationId, orgId)),
      });

      if (!queue) {
        return res.status(404).json({ error: "Queue not found" });
      }

      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(now);
      startOfWeek.setDate(startOfWeek.getDate() - 7);

      // Today's stats
      const todayServed = await db.select({ count: sql<number>`count(*)` })
        .from(queueTickets)
        .where(and(
          eq(queueTickets.queueId, queueId),
          eq(queueTickets.status, "completed"),
          gte(queueTickets.createdAt, startOfToday)
        ));

      const todayNoShows = await db.select({ count: sql<number>`count(*)` })
        .from(queueTickets)
        .where(and(
          eq(queueTickets.queueId, queueId),
          eq(queueTickets.status, "no_show"),
          gte(queueTickets.createdAt, startOfToday)
        ));

      const todayCancelled = await db.select({ count: sql<number>`count(*)` })
        .from(queueTickets)
        .where(and(
          eq(queueTickets.queueId, queueId),
          eq(queueTickets.status, "cancelled"),
          gte(queueTickets.createdAt, startOfToday)
        ));

      // Average wait time for today (servedAt - createdAt in minutes)
      const todayAvgWait = await db.select({
        avgWait: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${queueTickets.servedAt} - ${queueTickets.createdAt})) / 60), 0)`
      })
        .from(queueTickets)
        .where(and(
          eq(queueTickets.queueId, queueId),
          eq(queueTickets.status, "completed"),
          gte(queueTickets.createdAt, startOfToday),
          sql`${queueTickets.servedAt} IS NOT NULL`
        ));

      // Peak hours (group completed tickets by hour of createdAt)
      const peakHoursResult = await db.select({
        hour: sql<number>`EXTRACT(HOUR FROM ${queueTickets.createdAt})::integer`,
        count: sql<number>`count(*)::integer`
      })
        .from(queueTickets)
        .where(and(
          eq(queueTickets.queueId, queueId),
          eq(queueTickets.status, "completed"),
          gte(queueTickets.createdAt, startOfWeek)
        ))
        .groupBy(sql`EXTRACT(HOUR FROM ${queueTickets.createdAt})`)
        .orderBy(sql`EXTRACT(HOUR FROM ${queueTickets.createdAt})`);

      // Daily served for last 7 days
      const dailyServedResult = await db.select({
        date: sql<string>`DATE(${queueTickets.createdAt})::text`,
        count: sql<number>`count(*)::integer`
      })
        .from(queueTickets)
        .where(and(
          eq(queueTickets.queueId, queueId),
          eq(queueTickets.status, "completed"),
          gte(queueTickets.createdAt, startOfWeek)
        ))
        .groupBy(sql`DATE(${queueTickets.createdAt})`)
        .orderBy(sql`DATE(${queueTickets.createdAt})`);

      // All-time stats
      const allTimeServed = await db.select({ count: sql<number>`count(*)` })
        .from(queueTickets)
        .where(and(
          eq(queueTickets.queueId, queueId),
          eq(queueTickets.status, "completed")
        ));

      const allTimeAvgWait = await db.select({
        avgWait: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${queueTickets.servedAt} - ${queueTickets.createdAt})) / 60), 0)`
      })
        .from(queueTickets)
        .where(and(
          eq(queueTickets.queueId, queueId),
          eq(queueTickets.status, "completed"),
          sql`${queueTickets.servedAt} IS NOT NULL`
        ));

      res.json({
        today: {
          totalServed: Number(todayServed[0]?.count || 0),
          totalNoShows: Number(todayNoShows[0]?.count || 0),
          totalCancelled: Number(todayCancelled[0]?.count || 0),
          avgWaitTime: Math.round(Number(todayAvgWait[0]?.avgWait || 0) * 10) / 10,
        },
        weekly: {
          peakHours: peakHoursResult.map(h => ({ hour: Number(h.hour), count: Number(h.count) })),
          dailyServed: dailyServedResult.map(d => ({ date: d.date, count: Number(d.count) })),
        },
        allTime: {
          totalServed: Number(allTimeServed[0]?.count || 0),
          avgWaitTime: Math.round(Number(allTimeAvgWait[0]?.avgWait || 0) * 10) / 10,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get aggregate analytics for all queues in the organization
  app.get("/api/queues/org/analytics", requireOrgAdmin, async (req, res) => {
    try {
      const orgId = req.session?.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "Organization not found in session" });
      }

      // Get all queue IDs for this organization
      const orgQueues = await db.query.queues.findMany({
        where: eq(queues.organizationId, orgId),
        columns: { id: true },
      });

      if (orgQueues.length === 0) {
        return res.json({
          today: { totalServed: 0, totalNoShows: 0, totalCancelled: 0, avgWaitTime: 0 },
          weekly: { peakHours: [], dailyServed: [] },
          allTime: { totalServed: 0, avgWaitTime: 0 },
        });
      }

      const queueIds = orgQueues.map(q => q.id);
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfWeek = new Date(now);
      startOfWeek.setDate(startOfWeek.getDate() - 7);

      // Today's stats across all queues
      const todayServed = await db.select({ count: sql<number>`count(*)` })
        .from(queueTickets)
        .where(and(
          sql`${queueTickets.queueId} = ANY(${queueIds})`,
          eq(queueTickets.status, "completed"),
          gte(queueTickets.createdAt, startOfToday)
        ));

      const todayNoShows = await db.select({ count: sql<number>`count(*)` })
        .from(queueTickets)
        .where(and(
          sql`${queueTickets.queueId} = ANY(${queueIds})`,
          eq(queueTickets.status, "no_show"),
          gte(queueTickets.createdAt, startOfToday)
        ));

      const todayCancelled = await db.select({ count: sql<number>`count(*)` })
        .from(queueTickets)
        .where(and(
          sql`${queueTickets.queueId} = ANY(${queueIds})`,
          eq(queueTickets.status, "cancelled"),
          gte(queueTickets.createdAt, startOfToday)
        ));

      const todayAvgWait = await db.select({
        avgWait: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${queueTickets.servedAt} - ${queueTickets.createdAt})) / 60), 0)`
      })
        .from(queueTickets)
        .where(and(
          sql`${queueTickets.queueId} = ANY(${queueIds})`,
          eq(queueTickets.status, "completed"),
          gte(queueTickets.createdAt, startOfToday),
          sql`${queueTickets.servedAt} IS NOT NULL`
        ));

      // Peak hours
      const peakHoursResult = await db.select({
        hour: sql<number>`EXTRACT(HOUR FROM ${queueTickets.createdAt})::integer`,
        count: sql<number>`count(*)::integer`
      })
        .from(queueTickets)
        .where(and(
          sql`${queueTickets.queueId} = ANY(${queueIds})`,
          eq(queueTickets.status, "completed"),
          gte(queueTickets.createdAt, startOfWeek)
        ))
        .groupBy(sql`EXTRACT(HOUR FROM ${queueTickets.createdAt})`)
        .orderBy(sql`EXTRACT(HOUR FROM ${queueTickets.createdAt})`);

      // Daily served for last 7 days
      const dailyServedResult = await db.select({
        date: sql<string>`DATE(${queueTickets.createdAt})::text`,
        count: sql<number>`count(*)::integer`
      })
        .from(queueTickets)
        .where(and(
          sql`${queueTickets.queueId} = ANY(${queueIds})`,
          eq(queueTickets.status, "completed"),
          gte(queueTickets.createdAt, startOfWeek)
        ))
        .groupBy(sql`DATE(${queueTickets.createdAt})`)
        .orderBy(sql`DATE(${queueTickets.createdAt})`);

      // All-time stats
      const allTimeServed = await db.select({ count: sql<number>`count(*)` })
        .from(queueTickets)
        .where(and(
          sql`${queueTickets.queueId} = ANY(${queueIds})`,
          eq(queueTickets.status, "completed")
        ));

      const allTimeAvgWait = await db.select({
        avgWait: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${queueTickets.servedAt} - ${queueTickets.createdAt})) / 60), 0)`
      })
        .from(queueTickets)
        .where(and(
          sql`${queueTickets.queueId} = ANY(${queueIds})`,
          eq(queueTickets.status, "completed"),
          sql`${queueTickets.servedAt} IS NOT NULL`
        ));

      res.json({
        today: {
          totalServed: Number(todayServed[0]?.count || 0),
          totalNoShows: Number(todayNoShows[0]?.count || 0),
          totalCancelled: Number(todayCancelled[0]?.count || 0),
          avgWaitTime: Math.round(Number(todayAvgWait[0]?.avgWait || 0) * 10) / 10,
        },
        weekly: {
          peakHours: peakHoursResult.map(h => ({ hour: Number(h.hour), count: Number(h.count) })),
          dailyServed: dailyServedResult.map(d => ({ date: d.date, count: Number(d.count) })),
        },
        allTime: {
          totalServed: Number(allTimeServed[0]?.count || 0),
          avgWaitTime: Math.round(Number(allTimeAvgWait[0]?.avgWait || 0) * 10) / 10,
        },
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== TABLES ENDPOINTS ==========
  app.get("/api/tables", async (req, res) => {
    try {
      const tables = await storage.getTables();
      res.json(tables);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/tables/occupied", async (req, res) => {
    try {
      const tables = await storage.getOccupiedTablesWithOrders();
      res.json(tables);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/tables/:id", async (req, res) => {
    try {
      const table = await storage.getTableById(parseInt(req.params.id));
      if (!table) {
        return res.status(404).json({ error: "Table not found" });
      }
      res.json(table);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/tables/:id/orders", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
      const orders = await storage.getOrdersByTableId(parseInt(req.params.id), { limit, offset });
      res.json(orders);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/tables", async (req, res) => {
    try {
      const data = insertTableSchema.parse(req.body);
      const table = await storage.createTable(data);
      broadcast({ type: "table_created", data: table });
      res.status(201).json(table);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/tables/:id", async (req, res) => {
    try {
      const { status } = req.body;
      const table = await storage.updateTableStatus(parseInt(req.params.id), status);
      if (!table) {
        return res.status(404).json({ error: "Table not found" });
      }
      broadcast({ type: "table_updated", data: table });
      res.json(table);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/tables/:id", async (req, res) => {
    try {
      await storage.deleteTable(parseInt(req.params.id));
      broadcast({ type: "table_deleted", data: { id: parseInt(req.params.id) } });
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== MENU ITEMS ENDPOINTS ==========
  app.get("/api/menu", async (req, res) => {
    try {
      const items = await storage.getMenuItems();
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/menu", async (req, res) => {
    try {
      const data = insertMenuItemSchema.parse(req.body);
      const item = await storage.createMenuItem(data);
      broadcast({ type: "menu_item_created", data: item });
      res.status(201).json(item);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/menu/:id", async (req, res) => {
    try {
      const item = await storage.updateMenuItem(parseInt(req.params.id), req.body);
      if (!item) {
        return res.status(404).json({ error: "Menu item not found" });
      }
      broadcast({ type: "menu_item_updated", data: item });
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/menu/:id", async (req, res) => {
    try {
      await storage.deleteMenuItem(parseInt(req.params.id));
      broadcast({ type: "menu_item_deleted", data: { id: parseInt(req.params.id) } });
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== ORDERS ENDPOINTS ==========
  app.get("/api/orders", async (req, res) => {
    try {
      const orders = await storage.getOrders();
      res.json(orders);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/orders/:status", async (req, res) => {
    try {
      const orders = await storage.getOrdersByStatus(req.params.status);
      res.json(orders);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/orders", async (req, res) => {
    try {
      const { tableId, items } = req.body;

      // Create the order
      const order = await storage.createOrder({
        tableId,
        status: "pending",
        total: "0.00",
      });

      // Add order items
      let total = 0;
      for (const item of items) {
        const menuItem = await storage.getMenuItemById(item.menuItemId);
        if (!menuItem) continue;

        await storage.createOrderItem({
          orderId: order.id,
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          notes: item.notes,
          status: "queued",
          price: menuItem.price,
        });

        total += parseFloat(menuItem.price) * item.quantity;
      }

      // Update order total
      await storage.updateOrderTotal(order.id, total.toFixed(2));

      // Update table status to occupied
      await storage.updateTableStatus(tableId, "occupied");

      // Get the complete order with items
      const completeOrder = await storage.getOrderById(order.id);

      broadcast({ type: "order_created", data: completeOrder });
      res.status(201).json(completeOrder);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/orders/:id/confirm", async (req, res) => {
    try {
      const order = await storage.updateOrderStatus(parseInt(req.params.id), "confirmed");
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      const completeOrder = await storage.getOrderById(order.id);
      broadcast({ type: "order_confirmed", data: completeOrder });
      res.json(completeOrder);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/orders/:orderId/items/:itemId/status", async (req, res) => {
    try {
      const { status } = req.body;
      const item = await storage.updateOrderItemStatus(parseInt(req.params.itemId), status);
      if (!item) {
        return res.status(404).json({ error: "Order item not found" });
      }

      const order = await storage.getOrderById(parseInt(req.params.orderId));
      broadcast({ type: "order_item_status_updated", data: { item, order } });

      if (order && status === "ready") {
        const allReady = order.orderItems.every(
          (i) => i.status === "ready" || i.status === "delivered" || i.status === "cancelled"
        );
        if (allReady) {
          broadcast({ type: "order_ready", data: order });
        }
      }

      res.json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/orders/:orderId/items/:itemId/cancel", async (req, res) => {
    try {
      const item = await storage.getOrderItemById(parseInt(req.params.itemId));
      if (!item) {
        return res.status(404).json({ error: "Order item not found" });
      }

      // Only allow cancellation for queued or pending items
      if (!["queued", "pending"].includes(item.status)) {
        return res.status(400).json({
          error: "Cannot cancel item that is already being prepared or delivered",
        });
      }

      const updatedItem = await storage.updateOrderItemStatus(
        parseInt(req.params.itemId),
        "cancelled"
      );

      // Recalculate order total
      const order = await storage.getOrderById(parseInt(req.params.orderId));
      if (order) {
        const activeItems = order.orderItems.filter((i) => i.status !== "cancelled");
        const total = activeItems.reduce(
          (sum, i) => sum + parseFloat(i.price) * i.quantity,
          0
        );
        await storage.updateOrderTotal(order.id, total.toFixed(2));

        const updatedOrder = await storage.getOrderById(order.id);
        broadcast({ type: "order_item_cancelled", data: updatedOrder });
      }

      res.json(updatedItem);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== PAYMENTS ENDPOINTS ==========
  app.post("/api/payments", async (req, res) => {
    try {
      // Extract split bill flag before schema validation
      const isSplitBill = req.body.isSplitBill === true;
      const { isSplitBill: _, ...paymentData } = req.body;
      
      const data = insertPaymentSchema.parse(paymentData);
      const payment = await storage.createPayment(data);

      // For split bills, don't complete order/free table yet
      // These will be done when all bill shares are marked paid
      if (!isSplitBill) {
        // Mark order as completed
        await storage.updateOrderStatus(data.orderId!, "completed");

        // Mark table as free
        await storage.updateTableStatus(data.tableId!, "free");
      }

      broadcast({
        type: "payment_processed",
        data: {
          payment,
          orderId: data.orderId!,
          tableId: data.tableId!,
          isSplitBill,
        },
      });

      res.status(201).json(payment);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/payments/history", async (req, res) => {
    try {
      const payments = await storage.getPaymentHistory();
      res.json(payments);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== USERS ENDPOINTS ==========
  app.get("/api/users", async (req, res) => {
    try {
      const users = await storage.getUsers();
      res.json(users);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const data = insertUserSchema.parse(req.body);
      const user = await storage.createUser(data);
      res.status(201).json(user);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Update user (name, email, role, isActive) - Org Admin only
  app.patch("/api/users/:id", requireOrgAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const orgId = req.session?.organizationId;
      
      // Verify user belongs to the same organization
      const existingUser = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });
      
      if (!existingUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Super admin can edit any user, org admin can only edit their org's users
      if (req.session?.globalRole !== "super_admin") {
        if (existingUser.organizationId !== orgId) {
          return res.status(403).json({ error: "Cannot edit users from another organization" });
        }
        
        // Prevent org admin from modifying super_admin users
        if (existingUser.globalRole === "super_admin") {
          return res.status(403).json({ error: "Cannot modify super admin users" });
        }
      }
      
      const { name, email, role, isActive } = req.body;
      
      const [updatedUser] = await db.update(users)
        .set({
          ...(name !== undefined && { name }),
          ...(email !== undefined && { email }),
          ...(role !== undefined && { role }),
          ...(isActive !== undefined && { isActive }),
        })
        .where(eq(users.id, userId))
        .returning();
      
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      broadcast({ type: "user_updated", data: updatedUser });
      res.json(updatedUser);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Reset user password - Org Admin only
  app.patch("/api/users/:id/password", requireOrgAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const orgId = req.session?.organizationId;
      const { password } = req.body;
      
      if (!password || password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      
      // Verify user belongs to the same organization
      const existingUser = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });
      
      if (!existingUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Super admin can reset any password, org admin can only reset their org's users
      if (req.session?.globalRole !== "super_admin") {
        if (existingUser.organizationId !== orgId) {
          return res.status(403).json({ error: "Cannot reset password for users from another organization" });
        }
        
        // Prevent org admin from resetting super_admin password
        if (existingUser.globalRole === "super_admin") {
          return res.status(403).json({ error: "Cannot reset super admin password" });
        }
      }
      
      const hashedPassword = await hashPassword(password);
      
      const [updatedUser] = await db.update(users)
        .set({ password: hashedPassword })
        .where(eq(users.id, userId))
        .returning();
      
      if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      res.json({ message: "Password reset successfully" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Delete user - Org Admin only
  app.delete("/api/users/:id", requireOrgAdmin, async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const orgId = req.session?.organizationId;
      const currentUserId = req.session?.userId;
      
      // Prevent self-deletion
      if (userId === currentUserId) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }
      
      // Verify user belongs to the same organization
      const existingUser = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });
      
      if (!existingUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Super admin can delete any user, org admin can only delete their org's users
      if (req.session?.globalRole !== "super_admin") {
        if (existingUser.organizationId !== orgId) {
          return res.status(403).json({ error: "Cannot delete users from another organization" });
        }
        
        // Prevent org admin from deleting super_admin users
        if (existingUser.globalRole === "super_admin") {
          return res.status(403).json({ error: "Cannot delete super admin users" });
        }
      }
      
      await db.delete(users).where(eq(users.id, userId));
      
      broadcast({ type: "user_deleted", data: { id: userId } });
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== WAITER CALLS ENDPOINTS ==========
  app.get("/api/waiter-calls", async (req, res) => {
    try {
      const calls = await storage.getWaiterCalls();
      res.json(calls);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/waiter-calls", async (req, res) => {
    try {
      const data = insertWaiterCallSchema.parse(req.body);
      const call = await storage.createWaiterCall(data);
      broadcast({ type: "waiter_called", data: call });
      res.status(201).json(call);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.patch("/api/waiter-calls/:id/resolve", async (req, res) => {
    try {
      await storage.resolveWaiterCall(parseInt(req.params.id));
      broadcast({ type: "waiter_call_resolved", data: { id: parseInt(req.params.id) } });
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== BILL SHARES ENDPOINTS ==========
  
  // Create split bill payment with shares atomically using database transaction
  app.post("/api/split-bill", async (req, res) => {
    try {
      const { orderId, tableId, method, shares } = req.body;
      
      // Validate shares array
      if (!Array.isArray(shares) || shares.length === 0) {
        return res.status(400).json({ error: "At least one bill share is required" });
      }
      
      // Use database transaction for atomicity
      const result = await db.transaction(async (tx) => {
        // Fetch the order to get authoritative total
        const [order] = await tx.select()
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);
        
        if (!order) {
          throw new Error("Order not found");
        }
        
        if (order.status !== "confirmed") {
          throw new Error("Order must be confirmed to create split bill");
        }
        
        const authoritativeTotal = parseFloat(order.total);
        
        // Validate each share and enforce business rules
        const validatedShares = shares.map((share: any, index: number) => {
          if (!share.customerName || !share.customerName.trim()) {
            throw new Error(`Share ${index + 1}: Customer name is required`);
          }
          const shareAmount = parseFloat(share.amount);
          if (isNaN(shareAmount) || shareAmount <= 0) {
            throw new Error(`Share ${index + 1}: Amount must be positive`);
          }
          return {
            customerName: share.customerName.trim(),
            amount: share.amount,
          };
        });
        
        // Validate shares sum equals authoritative order total
        const sharesTotal = validatedShares.reduce((sum, s) => sum + parseFloat(s.amount), 0);
        if (Math.abs(sharesTotal - authoritativeTotal) > 0.01) {
          throw new Error(`Shares total ($${sharesTotal.toFixed(2)}) must equal order total ($${authoritativeTotal.toFixed(2)})`);
        }
        
        // Validate payment data with schema using authoritative total
        const paymentData = insertPaymentSchema.parse({
          orderId,
          tableId,
          amount: order.total,
          method,
        });
        
        // Create payment (without completing order/freeing table)
        const [payment] = await tx.insert(payments).values(paymentData).returning();
        
        // Create all bill shares within the same transaction
        const createdShares = [];
        for (const share of validatedShares) {
          const [createdShare] = await tx.insert(billShares).values({
            paymentId: payment.id,
            customerName: share.customerName,
            amount: share.amount,
            paid: false,
          }).returning();
          createdShares.push(createdShare);
        }
        
        return { payment, shares: createdShares };
      });
      
      res.status(201).json(result);
    } catch (error: any) {
      console.error("Split bill transaction failed:", error);
      res.status(400).json({ 
        error: error.message || "Failed to create split bill",
      });
    }
  });
  
  app.post("/api/bill-shares", async (req, res) => {
    try {
      const data = insertBillShareSchema.parse(req.body);
      const share = await storage.createBillShare(data);
      res.status(201).json(share);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/bill-shares/payment/:paymentId", async (req, res) => {
    try {
      const shares = await storage.getBillSharesByPaymentId(parseInt(req.params.paymentId));
      res.json(shares);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/bill-shares/:id/paid", async (req, res) => {
    try {
      const shareId = parseInt(req.params.id);
      
      // Use transaction to mark share paid AND complete order/table if all paid
      await db.transaction(async (tx) => {
        // Mark share as paid within transaction
        const [updatedShare] = await tx.update(billShares)
          .set({ paid: true })
          .where(eq(billShares.id, shareId))
          .returning();
        
        if (!updatedShare || !updatedShare.paymentId) {
          throw new Error("Share not found");
        }
        
        // Check if all shares for this payment are now paid
        const allShares = await tx.select()
          .from(billShares)
          .where(eq(billShares.paymentId, updatedShare.paymentId));
        
        const allPaid = allShares.every(s => s.paid);
        
        if (allPaid) {
          // Query payment to get order and table IDs
          const [payment] = await tx.select()
            .from(payments)
            .where(eq(payments.id, updatedShare.paymentId))
            .limit(1);
          
          if (!payment || !payment.orderId || !payment.tableId) {
            throw new Error("Payment not found or missing order/table reference");
          }
          
          // Complete order and free table atomically in same transaction
          await tx.update(orders)
            .set({ status: "completed" })
            .where(eq(orders.id, payment.orderId));
          
          await tx.update(tables)
            .set({ status: "free" })
            .where(eq(tables.id, payment.tableId));
          
          // Broadcast completion event after transaction commits
          broadcast({
            type: "split_bill_completed",
            data: {
              paymentId: updatedShare.paymentId,
              orderId: payment.orderId,
              tableId: payment.tableId,
            },
          });
        }
      });
      
      res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("Failed to update bill share:", error);
      res.status(500).json({
        error: error.message || "Failed to update bill share",
      });
    }
  });

  // ========== RESERVATIONS ENDPOINTS ==========
  app.post("/api/reservations", async (req, res) => {
    try {
      const data = insertReservationSchema.parse(req.body);
      const reservation = await storage.createReservation(data);
      broadcast({ type: "reservation_created", data: reservation });
      res.status(201).json(reservation);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/reservations", async (req, res) => {
    try {
      const reservations = await storage.getReservations();
      res.json(reservations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/reservations/date/:date", async (req, res) => {
    try {
      const date = new Date(req.params.date);
      const reservations = await storage.getReservationsByDate(date);
      res.json(reservations);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/reservations/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      const reservation = await storage.updateReservationStatus(parseInt(req.params.id), status);
      broadcast({ type: "reservation_updated", data: reservation });
      res.json(reservation);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/reservations/:id", async (req, res) => {
    try {
      await storage.deleteReservation(parseInt(req.params.id));
      broadcast({ type: "reservation_deleted", data: { id: parseInt(req.params.id) } });
      res.status(204).send();
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== DISH REVIEWS ENDPOINTS ==========
  app.post("/api/reviews", async (req, res) => {
    try {
      const data = insertDishReviewSchema.parse(req.body);
      const review = await storage.createDishReview(data);
      broadcast({ type: "review_created", data: review });
      res.status(201).json(review);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/reviews/:menuItemId", async (req, res) => {
    try {
      const reviews = await storage.getDishReviewsByMenuItemId(parseInt(req.params.menuItemId));
      const avgRating = await storage.getAverageRating(parseInt(req.params.menuItemId));
      res.json({ reviews, averageRating: avgRating });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== ANALYTICS ENDPOINTS ==========
  app.get("/api/analytics/sales", async (req, res) => {
    try {
      const startDate = new Date(req.query.start as string || new Date().setDate(new Date().getDate() - 30));
      const endDate = new Date(req.query.end as string || new Date());
      const analytics = await storage.getSalesAnalytics(startDate, endDate);
      res.json(analytics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/analytics/popular-items", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string || "10");
      const items = await storage.getPopularItems(limit);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/analytics/cancellation-rate", async (req, res) => {
    try {
      const rate = await storage.getCancellationRate();
      res.json({ cancellationRate: rate });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ========== IMAGE UPLOAD ENDPOINT ==========
  app.post("/api/upload", upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const imageUrl = `/uploads/${req.file.filename}`;
      res.json({ imageUrl });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}

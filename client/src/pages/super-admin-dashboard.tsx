import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Building2, CreditCard, AlertTriangle, Plus, CalendarPlus, History, Pencil, Trash2, LayoutDashboard, Package, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import type { Organization, SubscriptionPlan, Subscription } from "@shared/schema";

type AdminStats = {
  totalOrganizations: number;
  activeSubscriptions: number;
  expiringSoon: number;
};

type OrganizationWithStatus = Organization & {
  subscriptionStatus: "active" | "expired";
  currentPlan: SubscriptionPlan | null;
  expiresAt: string | null;
  daysRemaining: number;
};

type SubscriptionWithDetails = Subscription & {
  organization: Organization;
  plan: SubscriptionPlan;
};

type SubscriptionHistory = Subscription & {
  plan: SubscriptionPlan;
};

type SessionData = {
  authenticated: boolean;
  user?: {
    id: number;
    username: string;
    name: string;
    globalRole: string;
    role: string;
    email: string | null;
  };
};

export default function SuperAdminDashboard() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("dashboard");
  
  const [subscriptionDialogOpen, setSubscriptionDialogOpen] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<OrganizationWithStatus | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");

  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [planFormData, setPlanFormData] = useState({
    name: "",
    description: "",
    durationMonths: "1",
    price: "",
    features: "",
    organizationType: "restaurant" as "restaurant" | "queue_business" | "both",
    isActive: true,
  });

  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyOrg, setHistoryOrg] = useState<OrganizationWithStatus | null>(null);

  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [orgFormData, setOrgFormData] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    type: "restaurant" as "restaurant" | "queue_business" | "both",
    adminUsername: "",
    adminPassword: "",
    adminName: "",
    adminEmail: "",
  });

  const { data: session, isLoading: sessionLoading } = useQuery<SessionData>({
    queryKey: ["/api/auth/session"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ["/api/admin/stats"],
    enabled: session?.user?.globalRole === "super_admin",
  });

  const { data: organizations = [], isLoading: orgsLoading } = useQuery<OrganizationWithStatus[]>({
    queryKey: ["/api/admin/organizations"],
    enabled: session?.user?.globalRole === "super_admin",
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery<SubscriptionPlan[]>({
    queryKey: ["/api/admin/plans"],
    enabled: session?.user?.globalRole === "super_admin",
  });

  const { data: allSubscriptions = [], isLoading: subscriptionsLoading } = useQuery<SubscriptionWithDetails[]>({
    queryKey: ["/api/admin/subscriptions"],
    enabled: session?.user?.globalRole === "super_admin",
  });

  const { data: subscriptionHistory = [], isLoading: historyLoading } = useQuery<SubscriptionHistory[]>({
    queryKey: ["/api/admin/organizations", historyOrg?.id, "subscriptions"],
    enabled: !!historyOrg?.id,
  });

  const addSubscriptionMutation = useMutation({
    mutationFn: (data: { organizationId: number; planId: number; paymentNotes?: string; paymentAmount?: string }) =>
      apiRequest("POST", "/api/admin/subscriptions", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscriptions"] });
      setSubscriptionDialogOpen(false);
      setSelectedOrg(null);
      setSelectedPlanId("");
      setPaymentNotes("");
      setPaymentAmount("");
      toast({ title: "Subscription added successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add subscription",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createOrgMutation = useMutation({
    mutationFn: (data: typeof orgFormData) =>
      apiRequest("POST", "/api/admin/organizations", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setOrgDialogOpen(false);
      resetOrgForm();
      toast({ title: "Organization created successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create organization",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createPlanMutation = useMutation({
    mutationFn: (data: typeof planFormData) =>
      apiRequest("POST", "/api/admin/plans", {
        ...data,
        durationMonths: parseInt(data.durationMonths),
        price: data.price,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      setPlanDialogOpen(false);
      resetPlanForm();
      toast({ title: "Plan created successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to create plan",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updatePlanMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof planFormData }) =>
      apiRequest("PATCH", `/api/admin/plans/${id}`, {
        ...data,
        durationMonths: parseInt(data.durationMonths),
        price: data.price,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      setPlanDialogOpen(false);
      setEditingPlan(null);
      resetPlanForm();
      toast({ title: "Plan updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update plan",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deletePlanMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/plans/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/plans"] });
      toast({ title: "Plan deactivated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to deactivate plan",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleOrgActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/admin/organizations/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
      toast({ title: "Organization status updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update organization",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddSubscription = (org: OrganizationWithStatus) => {
    setSelectedOrg(org);
    setSubscriptionDialogOpen(true);
  };

  const handleConfirmSubscription = () => {
    if (!selectedOrg || !selectedPlanId) return;
    addSubscriptionMutation.mutate({
      organizationId: selectedOrg.id,
      planId: parseInt(selectedPlanId),
      paymentNotes: paymentNotes || undefined,
      paymentAmount: paymentAmount || undefined,
    });
  };

  const resetPlanForm = () => {
    setPlanFormData({
      name: "",
      description: "",
      durationMonths: "1",
      price: "",
      features: "",
      organizationType: "restaurant",
      isActive: true,
    });
  };

  const resetOrgForm = () => {
    setOrgFormData({
      name: "",
      email: "",
      phone: "",
      address: "",
      type: "restaurant",
      adminUsername: "",
      adminPassword: "",
      adminName: "",
      adminEmail: "",
    });
  };

  const handleCreateOrg = () => {
    setOrgDialogOpen(true);
  };

  const handleSaveOrg = () => {
    createOrgMutation.mutate(orgFormData);
  };

  const handleAddPlan = () => {
    setEditingPlan(null);
    resetPlanForm();
    setPlanDialogOpen(true);
  };

  const handleEditPlan = (plan: SubscriptionPlan) => {
    setEditingPlan(plan);
    setPlanFormData({
      name: plan.name,
      description: plan.description || "",
      durationMonths: plan.durationMonths.toString(),
      price: plan.price,
      features: plan.features || "",
      organizationType: plan.organizationType,
      isActive: plan.isActive,
    });
    setPlanDialogOpen(true);
  };

  const handleSavePlan = () => {
    if (editingPlan) {
      updatePlanMutation.mutate({ id: editingPlan.id, data: planFormData });
    } else {
      createPlanMutation.mutate(planFormData);
    }
  };

  const handleDeletePlan = (plan: SubscriptionPlan) => {
    if (confirm(`Are you sure you want to deactivate "${plan.name}"?`)) {
      deletePlanMutation.mutate(plan.id);
    }
  };

  const handleShowHistory = (org: OrganizationWithStatus) => {
    setHistoryOrg(org);
    setHistoryDialogOpen(true);
  };

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  if (sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!session?.authenticated || session.user?.globalRole !== "super_admin") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="text-destructive">Access Denied</CardTitle>
            <CardDescription>
              You don't have permission to access this page. Only super administrators can view this dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate("/")} className="w-full">
              Go to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isLoading = statsLoading || orgsLoading;

  return (
    <div className="min-h-screen bg-background">
      <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Super Admin Dashboard</h1>
            <p className="text-muted-foreground">Manage all organization subscriptions</p>
          </div>
          <Badge variant="outline" className="w-fit">
            {session.user?.name || session.user?.username}
          </Badge>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
            <TabsTrigger value="dashboard" className="flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="organizations" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              <span className="hidden sm:inline">Organizations</span>
            </TabsTrigger>
            <TabsTrigger value="plans" className="flex items-center gap-2">
              <Package className="h-4 w-4" />
              <span className="hidden sm:inline">Plans</span>
            </TabsTrigger>
            <TabsTrigger value="subscriptions" className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              <span className="hidden sm:inline">Subscriptions</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <Building2 className="h-4 w-4 text-primary" />
                    Total Organizations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold">
                    {isLoading ? "..." : stats?.totalOrganizations || 0}
                  </p>
                  <p className="text-xs text-muted-foreground">Registered businesses</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <CreditCard className="h-4 w-4 text-green-500" />
                    Active Subscriptions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-green-600">
                    {isLoading ? "..." : stats?.activeSubscriptions || 0}
                  </p>
                  <p className="text-xs text-muted-foreground">Currently active</p>
                </CardContent>
              </Card>

              <Card className="sm:col-span-2 lg:col-span-1">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    Expiring Soon
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-amber-600">
                    {isLoading ? "..." : stats?.expiringSoon || 0}
                  </p>
                  <p className="text-xs text-muted-foreground">Within 7 days</p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="organizations" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Organizations</CardTitle>
                  <CardDescription>
                    View and manage all registered organizations and their subscriptions
                  </CardDescription>
                </div>
                <Button onClick={handleCreateOrg}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Organization
                </Button>
              </CardHeader>
              <CardContent>
                {orgsLoading ? (
                  <div className="py-8 text-center text-muted-foreground">
                    Loading organizations...
                  </div>
                ) : organizations.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    No organizations registered yet
                  </div>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <ScrollArea className="w-full">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Email</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Active</TableHead>
                              <TableHead>Current Plan</TableHead>
                              <TableHead>Days Remaining</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {organizations.map((org) => (
                              <TableRow key={org.id}>
                                <TableCell className="font-medium">{org.name}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="capitalize">
                                    {org.type.replace("_", " ")}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {org.email}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={org.subscriptionStatus === "active" ? "default" : "destructive"}
                                  >
                                    {org.subscriptionStatus === "active" ? "Active" : "Expired"}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Switch
                                    checked={org.isActive}
                                    onCheckedChange={(checked) =>
                                      toggleOrgActiveMutation.mutate({ id: org.id, isActive: checked })
                                    }
                                    disabled={toggleOrgActiveMutation.isPending}
                                  />
                                </TableCell>
                                <TableCell>
                                  {org.currentPlan?.name || (
                                    <span className="text-muted-foreground">No plan</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  {org.subscriptionStatus === "active" ? (
                                    <span
                                      className={
                                        org.daysRemaining <= 7
                                          ? "text-amber-600 font-medium"
                                          : ""
                                      }
                                    >
                                      {org.daysRemaining} days
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleShowHistory(org)}
                                    >
                                      <History className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => handleAddSubscription(org)}
                                    >
                                      <CalendarPlus className="h-4 w-4 mr-1" />
                                      {org.subscriptionStatus === "active" ? "Extend" : "Add"}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </div>

                    <div className="md:hidden space-y-4">
                      {organizations.map((org) => (
                        <Card key={org.id} className="p-4">
                          <div className="space-y-3">
                            <div className="flex items-start justify-between">
                              <div>
                                <h3 className="font-medium">{org.name}</h3>
                                <p className="text-sm text-muted-foreground">{org.email}</p>
                              </div>
                              <Badge
                                variant={org.subscriptionStatus === "active" ? "default" : "destructive"}
                              >
                                {org.subscriptionStatus === "active" ? "Active" : "Expired"}
                              </Badge>
                            </div>

                            <div className="flex flex-wrap gap-2 items-center">
                              <Badge variant="outline" className="capitalize">
                                {org.type.replace("_", " ")}
                              </Badge>
                              {org.currentPlan && (
                                <Badge variant="secondary">{org.currentPlan.name}</Badge>
                              )}
                              <div className="flex items-center gap-2 ml-auto">
                                <Label htmlFor={`org-active-${org.id}`} className="text-sm">Active</Label>
                                <Switch
                                  id={`org-active-${org.id}`}
                                  checked={org.isActive}
                                  onCheckedChange={(checked) =>
                                    toggleOrgActiveMutation.mutate({ id: org.id, isActive: checked })
                                  }
                                  disabled={toggleOrgActiveMutation.isPending}
                                />
                              </div>
                            </div>

                            <div className="flex items-center justify-between pt-2">
                              <div className="text-sm">
                                {org.subscriptionStatus === "active" ? (
                                  <span
                                    className={
                                      org.daysRemaining <= 7
                                        ? "text-amber-600 font-medium"
                                        : "text-muted-foreground"
                                    }
                                  >
                                    {org.daysRemaining} days remaining
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">No active subscription</span>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleShowHistory(org)}
                                >
                                  <History className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => handleAddSubscription(org)}
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  {org.subscriptionStatus === "active" ? "Extend" : "Add"}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="plans" className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Subscription Plans</CardTitle>
                  <CardDescription>
                    Manage subscription plans for all organization types
                  </CardDescription>
                </div>
                <Button onClick={handleAddPlan}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Plan
                </Button>
              </CardHeader>
              <CardContent>
                {plansLoading ? (
                  <div className="py-8 text-center text-muted-foreground">
                    Loading plans...
                  </div>
                ) : plans.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    No subscription plans created yet
                  </div>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <ScrollArea className="w-full">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Name</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Duration</TableHead>
                              <TableHead>Price</TableHead>
                              <TableHead>Features</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {plans.map((plan) => (
                              <TableRow key={plan.id}>
                                <TableCell className="font-medium">{plan.name}</TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="capitalize">
                                    {plan.organizationType.replace("_", " ")}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  {plan.durationMonths} month{plan.durationMonths > 1 ? "s" : ""}
                                </TableCell>
                                <TableCell className="font-medium">${plan.price}</TableCell>
                                <TableCell className="max-w-[200px] truncate">
                                  {plan.features || "—"}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={plan.isActive ? "default" : "secondary"}>
                                    {plan.isActive ? "Active" : "Inactive"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleEditPlan(plan)}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={() => handleDeletePlan(plan)}
                                      disabled={!plan.isActive}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </div>

                    <div className="md:hidden space-y-4">
                      {plans.map((plan) => (
                        <Card key={plan.id} className="p-4">
                          <div className="space-y-3">
                            <div className="flex items-start justify-between">
                              <div>
                                <h3 className="font-medium">{plan.name}</h3>
                                <p className="text-sm text-muted-foreground">{plan.description}</p>
                              </div>
                              <Badge variant={plan.isActive ? "default" : "secondary"}>
                                {plan.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Badge variant="outline" className="capitalize">
                                {plan.organizationType.replace("_", " ")}
                              </Badge>
                              <Badge variant="secondary">
                                {plan.durationMonths} month{plan.durationMonths > 1 ? "s" : ""}
                              </Badge>
                              <Badge variant="secondary" className="font-medium">
                                ${plan.price}
                              </Badge>
                            </div>

                            {plan.features && (
                              <p className="text-sm text-muted-foreground truncate">
                                Features: {plan.features}
                              </p>
                            )}

                            <div className="flex items-center justify-end gap-2 pt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditPlan(plan)}
                              >
                                <Pencil className="h-4 w-4 mr-1" />
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDeletePlan(plan)}
                                disabled={!plan.isActive}
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                Deactivate
                              </Button>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="subscriptions" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>All Subscriptions</CardTitle>
                <CardDescription>
                  View all subscription records across organizations
                </CardDescription>
              </CardHeader>
              <CardContent>
                {subscriptionsLoading ? (
                  <div className="py-8 text-center text-muted-foreground">
                    Loading subscriptions...
                  </div>
                ) : allSubscriptions.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    No subscriptions found
                  </div>
                ) : (
                  <>
                    <div className="hidden md:block">
                      <ScrollArea className="w-full">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Organization</TableHead>
                              <TableHead>Plan</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Start Date</TableHead>
                              <TableHead>End Date</TableHead>
                              <TableHead>Payment Amount</TableHead>
                              <TableHead>Payment Notes</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {allSubscriptions.map((sub) => (
                              <TableRow key={sub.id}>
                                <TableCell className="font-medium">
                                  {sub.organization?.name || "Unknown"}
                                </TableCell>
                                <TableCell>{sub.plan?.name || "Unknown"}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      sub.status === "active"
                                        ? "default"
                                        : sub.status === "expired"
                                        ? "destructive"
                                        : "secondary"
                                    }
                                    className="capitalize"
                                  >
                                    {sub.status}
                                  </Badge>
                                </TableCell>
                                <TableCell>{formatDate(sub.startDate)}</TableCell>
                                <TableCell>{formatDate(sub.endDate)}</TableCell>
                                <TableCell>
                                  {sub.paymentAmount ? `$${sub.paymentAmount}` : "—"}
                                </TableCell>
                                <TableCell className="max-w-[200px] truncate">
                                  {sub.paymentNotes || "—"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </div>

                    <div className="md:hidden space-y-4">
                      {allSubscriptions.map((sub) => (
                        <Card key={sub.id} className="p-4">
                          <div className="space-y-3">
                            <div className="flex items-start justify-between">
                              <div>
                                <h3 className="font-medium">{sub.organization?.name || "Unknown"}</h3>
                                <p className="text-sm text-muted-foreground">{sub.plan?.name || "Unknown"}</p>
                              </div>
                              <Badge
                                variant={
                                  sub.status === "active"
                                    ? "default"
                                    : sub.status === "expired"
                                    ? "destructive"
                                    : "secondary"
                                }
                                className="capitalize"
                              >
                                {sub.status}
                              </Badge>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div>
                                <span className="text-muted-foreground">Start: </span>
                                {formatDate(sub.startDate)}
                              </div>
                              <div>
                                <span className="text-muted-foreground">End: </span>
                                {formatDate(sub.endDate)}
                              </div>
                            </div>

                            {(sub.paymentAmount || sub.paymentNotes) && (
                              <div className="text-sm space-y-1">
                                {sub.paymentAmount && (
                                  <p>
                                    <span className="text-muted-foreground">Amount: </span>
                                    ${sub.paymentAmount}
                                  </p>
                                )}
                                {sub.paymentNotes && (
                                  <p className="truncate">
                                    <span className="text-muted-foreground">Notes: </span>
                                    {sub.paymentNotes}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </Card>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={subscriptionDialogOpen} onOpenChange={setSubscriptionDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedOrg?.subscriptionStatus === "active" ? "Extend" : "Add"} Subscription
            </DialogTitle>
            <DialogDescription>
              {selectedOrg?.subscriptionStatus === "active"
                ? `Extend subscription for ${selectedOrg?.name}. The new period will start from the current subscription's end date.`
                : `Add a new subscription for ${selectedOrg?.name}.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Organization</Label>
              <p className="text-sm text-muted-foreground">{selectedOrg?.name}</p>
            </div>

            <div className="space-y-2">
              <Label>Select Plan</Label>
              <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a subscription plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans
                    .filter((plan) => plan.isActive && (
                      plan.organizationType === selectedOrg?.type ||
                      selectedOrg?.type === "both" ||
                      plan.organizationType === "both"
                    ))
                    .map((plan) => (
                      <SelectItem key={plan.id} value={plan.id.toString()}>
                        <div className="flex items-center justify-between gap-4">
                          <span>{plan.name}</span>
                          <span className="text-muted-foreground">
                            ${plan.price} / {plan.durationMonths} month{plan.durationMonths > 1 ? "s" : ""}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  {plans.filter((plan) => plan.isActive && (
                    plan.organizationType === selectedOrg?.type ||
                    selectedOrg?.type === "both" ||
                    plan.organizationType === "both"
                  )).length === 0 && (
                    <SelectItem value="none" disabled>
                      No plans available for this organization type
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {selectedPlanId && (
              <div className="rounded-lg bg-muted p-3">
                {(() => {
                  const plan = plans.find((p) => p.id.toString() === selectedPlanId);
                  return plan ? (
                    <div className="space-y-1">
                      <p className="font-medium">{plan.name}</p>
                      <p className="text-sm text-muted-foreground">{plan.description}</p>
                      <p className="text-sm">
                        Duration: {plan.durationMonths} month{plan.durationMonths > 1 ? "s" : ""}
                      </p>
                      <p className="text-sm font-medium text-primary">
                        Price: ${plan.price}
                      </p>
                    </div>
                  ) : null;
                })()}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="paymentAmount">Payment Amount</Label>
              <Input
                id="paymentAmount"
                type="number"
                step="0.01"
                placeholder={selectedPlanId ? `Default: $${plans.find(p => p.id.toString() === selectedPlanId)?.price || "0"}` : "Enter amount"}
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentNotes">Payment Notes</Label>
              <Textarea
                id="paymentNotes"
                placeholder="Enter offline payment details (e.g., check number, transfer reference, etc.)"
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSubscriptionDialogOpen(false);
                setSelectedOrg(null);
                setSelectedPlanId("");
                setPaymentNotes("");
                setPaymentAmount("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmSubscription}
              disabled={!selectedPlanId || addSubscriptionMutation.isPending}
            >
              {addSubscriptionMutation.isPending ? "Adding..." : "Confirm Subscription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPlan ? "Edit Plan" : "Add New Plan"}</DialogTitle>
            <DialogDescription>
              {editingPlan ? "Update the subscription plan details." : "Create a new subscription plan for organizations."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="planName">Plan Name</Label>
                <Input
                  id="planName"
                  placeholder="e.g., Basic Monthly"
                  value={planFormData.name}
                  onChange={(e) => setPlanFormData({ ...planFormData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="planPrice">Price ($)</Label>
                <Input
                  id="planPrice"
                  type="number"
                  step="0.01"
                  placeholder="29.99"
                  value={planFormData.price}
                  onChange={(e) => setPlanFormData({ ...planFormData, price: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="planDescription">Description</Label>
              <Textarea
                id="planDescription"
                placeholder="Brief description of the plan..."
                value={planFormData.description}
                onChange={(e) => setPlanFormData({ ...planFormData, description: e.target.value })}
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="planDuration">Duration (Months)</Label>
                <Select
                  value={planFormData.durationMonths}
                  onValueChange={(value) => setPlanFormData({ ...planFormData, durationMonths: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 Month</SelectItem>
                    <SelectItem value="3">3 Months</SelectItem>
                    <SelectItem value="6">6 Months</SelectItem>
                    <SelectItem value="12">12 Months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="planOrgType">Organization Type</Label>
                <Select
                  value={planFormData.organizationType}
                  onValueChange={(value: "restaurant" | "queue_business") =>
                    setPlanFormData({ ...planFormData, organizationType: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="restaurant">Restaurant</SelectItem>
                    <SelectItem value="queue_business">Queue Business</SelectItem>
                    <SelectItem value="both">Both (Restaurant + Queue)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="planFeatures">Features (comma-separated)</Label>
              <Textarea
                id="planFeatures"
                placeholder="e.g., Unlimited orders, Real-time updates, Priority support"
                value={planFormData.features}
                onChange={(e) => setPlanFormData({ ...planFormData, features: e.target.value })}
                rows={2}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="planActive"
                checked={planFormData.isActive}
                onCheckedChange={(checked) => setPlanFormData({ ...planFormData, isActive: checked })}
              />
              <Label htmlFor="planActive">Active</Label>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setPlanDialogOpen(false);
                setEditingPlan(null);
                resetPlanForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSavePlan}
              disabled={!planFormData.name || !planFormData.price || createPlanMutation.isPending || updatePlanMutation.isPending}
            >
              {createPlanMutation.isPending || updatePlanMutation.isPending
                ? "Saving..."
                : editingPlan
                ? "Update Plan"
                : "Create Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyDialogOpen} onOpenChange={setHistoryDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Subscription History</DialogTitle>
            <DialogDescription>
              Subscription history for {historyOrg?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            {historyLoading ? (
              <div className="py-8 text-center text-muted-foreground">
                Loading history...
              </div>
            ) : subscriptionHistory.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                No subscription history found
              </div>
            ) : (
              <ScrollArea className="max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plan</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subscriptionHistory.map((sub) => (
                      <TableRow key={sub.id}>
                        <TableCell className="font-medium">{sub.plan?.name || "Unknown"}</TableCell>
                        <TableCell>{formatDate(sub.startDate)}</TableCell>
                        <TableCell>{formatDate(sub.endDate)}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              sub.status === "active"
                                ? "default"
                                : sub.status === "expired"
                                ? "destructive"
                                : "secondary"
                            }
                            className="capitalize"
                          >
                            {sub.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {sub.paymentAmount ? `$${sub.paymentAmount}` : "—"}
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {sub.paymentNotes || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setHistoryDialogOpen(false);
                setHistoryOrg(null);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={orgDialogOpen} onOpenChange={setOrgDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Organization</DialogTitle>
            <DialogDescription>
              Create a new business with an admin account
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground">Organization Details</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="orgName">Business Name *</Label>
                  <Input
                    id="orgName"
                    placeholder="e.g., Café Milano"
                    value={orgFormData.name}
                    onChange={(e) => setOrgFormData({ ...orgFormData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orgType">Business Type *</Label>
                  <Select
                    value={orgFormData.type}
                    onValueChange={(value: "restaurant" | "queue_business" | "both") => 
                      setOrgFormData({ ...orgFormData, type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="restaurant">Restaurant Only</SelectItem>
                      <SelectItem value="queue_business">Queue Management Only</SelectItem>
                      <SelectItem value="both">Restaurant + Queue (Both)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="orgEmail">Business Email *</Label>
                  <Input
                    id="orgEmail"
                    type="email"
                    placeholder="contact@business.com"
                    value={orgFormData.email}
                    onChange={(e) => setOrgFormData({ ...orgFormData, email: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orgPhone">Phone (optional)</Label>
                  <Input
                    id="orgPhone"
                    placeholder="+1 234 567 8900"
                    value={orgFormData.phone}
                    onChange={(e) => setOrgFormData({ ...orgFormData, phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="orgAddress">Address (optional)</Label>
                <Input
                  id="orgAddress"
                  placeholder="123 Main St, City, Country"
                  value={orgFormData.address}
                  onChange={(e) => setOrgFormData({ ...orgFormData, address: e.target.value })}
                />
              </div>
            </div>

            <div className="border-t pt-4 space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground">Admin Account</h4>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="adminName">Admin Name *</Label>
                  <Input
                    id="adminName"
                    placeholder="John Doe"
                    value={orgFormData.adminName}
                    onChange={(e) => setOrgFormData({ ...orgFormData, adminName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adminEmail">Admin Email (optional)</Label>
                  <Input
                    id="adminEmail"
                    type="email"
                    placeholder="admin@business.com"
                    value={orgFormData.adminEmail}
                    onChange={(e) => setOrgFormData({ ...orgFormData, adminEmail: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="adminUsername">Username *</Label>
                  <Input
                    id="adminUsername"
                    placeholder="johndoe"
                    value={orgFormData.adminUsername}
                    onChange={(e) => setOrgFormData({ ...orgFormData, adminUsername: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adminPassword">Password *</Label>
                  <Input
                    id="adminPassword"
                    type="password"
                    placeholder="Min 6 characters"
                    value={orgFormData.adminPassword}
                    onChange={(e) => setOrgFormData({ ...orgFormData, adminPassword: e.target.value })}
                  />
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setOrgDialogOpen(false);
                resetOrgForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveOrg}
              disabled={
                !orgFormData.name || 
                !orgFormData.email || 
                !orgFormData.adminUsername || 
                !orgFormData.adminPassword || 
                !orgFormData.adminName ||
                createOrgMutation.isPending
              }
            >
              {createOrgMutation.isPending ? "Creating..." : "Create Organization"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

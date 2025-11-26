import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Edit, Trash2, QrCode, Download, Users, UtensilsCrossed, LayoutDashboard, Upload, Settings, AlertTriangle, KeyRound, Palette, Building2, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { insertMenuItemSchema, insertTableSchema, insertUserSchema, type MenuItem, type Table as TableType, type User, type Organization } from "@shared/schema";
import type { z } from "zod";
import QRCodeLib from "qrcode";
import { format } from "date-fns";

interface SubscriptionStatus {
  hasActiveSubscription: boolean;
  subscription?: {
    id: number;
    status: string;
    startDate: string;
    endDate: string;
    daysRemaining: number;
    plan: {
      id: number;
      name: string;
      description: string | null;
      durationMonths: number;
      price: string;
    };
  };
  message: string | null;
  contactEmail: string;
}

interface SessionData {
  authenticated: boolean;
  user?: {
    id: number;
    username: string;
    name: string;
    globalRole: string;
    role: string;
    email: string;
  };
}

export default function AdminPanel() {
  const { toast } = useToast();
  const [menuDialogOpen, setMenuDialogOpen] = useState(false);
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editUserDialogOpen, setEditUserDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [editingTable, setEditingTable] = useState<TableType | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>("");
  const [imagePreview, setImagePreview] = useState<string>("");
  const [settingsLogoPreview, setSettingsLogoPreview] = useState<string>("");
  
  const [editUserForm, setEditUserForm] = useState({
    name: "",
    email: "",
    role: "waiter" as "admin" | "waiter" | "kitchen" | "cashier",
  });
  
  const [settingsForm, setSettingsForm] = useState({
    name: "",
    slogan: "",
    description: "",
    phone: "",
    address: "",
    businessHours: "",
    logoUrl: "",
    primaryColor: "#8B5A2B",
    secondaryColor: "#FFF8E7",
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const formData = new FormData();
        formData.append("image", file);

        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error("Upload failed");
        }

        const data = await response.json();
        setImagePreview(data.imageUrl);
        menuForm.setValue("imageUrl", data.imageUrl);
        toast({ title: "Image uploaded successfully" });
      } catch (error) {
        toast({
          title: "Upload failed",
          description: "Failed to upload image",
          variant: "destructive",
        });
      }
    }
  };

  const handleSettingsLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const formData = new FormData();
        formData.append("image", file);

        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error("Upload failed");
        }

        const data = await response.json();
        setSettingsLogoPreview(data.imageUrl);
        setSettingsForm(prev => ({ ...prev, logoUrl: data.imageUrl }));
        toast({ title: "Logo uploaded successfully" });
      } catch (error) {
        toast({
          title: "Upload failed",
          description: "Failed to upload logo",
          variant: "destructive",
        });
      }
    }
  };

  const { data: menuItems = [] } = useQuery<MenuItem[]>({
    queryKey: ["/api/menu"],
  });

  const { data: tables = [] } = useQuery<TableType[]>({
    queryKey: ["/api/tables"],
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: orgSettings, isLoading: orgSettingsLoading } = useQuery<Organization>({
    queryKey: ["/api/org/settings"],
  });

  const { data: subscriptionStatus, isLoading: subscriptionLoading } = useQuery<SubscriptionStatus>({
    queryKey: ["/api/org/subscription"],
  });

  const { data: sessionData } = useQuery<SessionData>({
    queryKey: ["/api/auth/session"],
  });

  const currentUserId = sessionData?.user?.id;

  const updateSettingsMutation = useMutation({
    mutationFn: (data: Partial<Organization>) =>
      apiRequest("PATCH", "/api/org/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/org/settings"] });
      toast({ title: "Settings saved successfully" });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save settings",
        variant: "destructive",
      });
    },
  });

  React.useEffect(() => {
    if (orgSettings) {
      setSettingsForm({
        name: orgSettings.name || "",
        slogan: orgSettings.slogan || "",
        description: orgSettings.description || "",
        phone: orgSettings.phone || "",
        address: orgSettings.address || "",
        businessHours: orgSettings.businessHours || "",
        logoUrl: orgSettings.logoUrl || "",
        primaryColor: orgSettings.primaryColor || "#8B5A2B",
        secondaryColor: orgSettings.secondaryColor || "#FFF8E7",
      });
      if (orgSettings.logoUrl) {
        setSettingsLogoPreview(orgSettings.logoUrl);
      }
    }
  }, [orgSettings]);

  const handleSettingsSave = () => {
    updateSettingsMutation.mutate(settingsForm);
  };

  const menuForm = useForm<z.infer<typeof insertMenuItemSchema>>({
    resolver: zodResolver(insertMenuItemSchema),
    defaultValues: {
      name: "",
      category: "mains",
      price: "0.00",
      description: "",
      imageUrl: "",
      available: true,
    },
  });

  const tableForm = useForm<z.infer<typeof insertTableSchema>>({
    resolver: zodResolver(insertTableSchema),
    defaultValues: {
      number: 1,
      capacity: 4,
      status: "free",
      qrCode: "",
    },
  });

  const userForm = useForm<z.infer<typeof insertUserSchema>>({
    resolver: zodResolver(insertUserSchema),
    defaultValues: {
      username: "",
      password: "",
      role: "waiter",
      name: "",
    },
  });

  const createMenuItemMutation = useMutation({
    mutationFn: (data: z.infer<typeof insertMenuItemSchema>) =>
      apiRequest("POST", "/api/menu", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu"] });
      setMenuDialogOpen(false);
      menuForm.reset();
      toast({ title: "Menu item created" });
    },
  });

  const updateMenuItemMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<MenuItem> }) =>
      apiRequest("PATCH", `/api/menu/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu"] });
      setMenuDialogOpen(false);
      setEditingItem(null);
      menuForm.reset();
      toast({ title: "Menu item updated" });
    },
  });

  const deleteMenuItemMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/menu/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/menu"] });
      toast({ title: "Menu item deleted" });
    },
  });

  const createTableMutation = useMutation({
    mutationFn: (data: z.infer<typeof insertTableSchema>) =>
      apiRequest("POST", "/api/tables", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      setTableDialogOpen(false);
      tableForm.reset();
      toast({ title: "Table created" });
    },
  });

  const deleteTableMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tables/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables"] });
      toast({ title: "Table deleted" });
    },
  });

  const createUserMutation = useMutation({
    mutationFn: (data: z.infer<typeof insertUserSchema>) =>
      apiRequest("POST", "/api/users", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setUserDialogOpen(false);
      userForm.reset();
      toast({ title: "User created" });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { name?: string; email?: string; role?: string; isActive?: boolean } }) =>
      apiRequest("PATCH", `/api/users/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditUserDialogOpen(false);
      setEditingUser(null);
      toast({ title: "User updated successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user",
        variant: "destructive",
      });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      apiRequest("PATCH", `/api/users/${id}/password`, { password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setResetPasswordDialogOpen(false);
      setEditingUser(null);
      setNewPassword("");
      toast({ title: "Password reset successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reset password",
        variant: "destructive",
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/users/${id}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User deleted successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete user",
        variant: "destructive",
      });
    },
  });

  const toggleUserActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/users/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User status updated" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user status",
        variant: "destructive",
      });
    },
  });

  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setEditUserForm({
      name: user.name,
      email: user.email || "",
      role: user.role,
    });
    setEditUserDialogOpen(true);
  };

  const handleEditUserSubmit = () => {
    if (editingUser) {
      updateUserMutation.mutate({
        id: editingUser.id,
        data: editUserForm,
      });
    }
  };

  const handleResetPassword = (user: User) => {
    setEditingUser(user);
    setNewPassword("");
    setResetPasswordDialogOpen(true);
  };

  const handleResetPasswordSubmit = () => {
    if (editingUser && newPassword.length >= 6) {
      resetPasswordMutation.mutate({
        id: editingUser.id,
        password: newPassword,
      });
    } else {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters",
        variant: "destructive",
      });
    }
  };

  const handleMenuSubmit = (data: z.infer<typeof insertMenuItemSchema>) => {
    if (!data.imageUrl) {
      toast({
        title: "Error",
        description: "Please upload or provide an image URL",
        variant: "destructive",
      });
      return;
    }
    if (editingItem) {
      updateMenuItemMutation.mutate({ id: editingItem.id, data });
    } else {
      createMenuItemMutation.mutate(data);
    }
    setImagePreview("");
  };

  const handleEditMenuItem = (item: MenuItem) => {
    setEditingItem(item);
    setImagePreview(item.imageUrl);
    menuForm.reset(item);
    setMenuDialogOpen(true);
  };

  const handleGenerateQR = async (table: TableType) => {
    const url = `${window.location.origin}/menu?table=${table.id}`;
    const dataUrl = await QRCodeLib.toDataURL(url, { width: 300 });
    setQrCodeDataUrl(dataUrl);
  };

  const handleDownloadQR = () => {
    const link = document.createElement("a");
    link.download = "table-qr-code.png";
    link.href = qrCodeDataUrl;
    link.click();
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Admin Panel</h1>
        <p className="text-muted-foreground">Manage your restaurant system</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UtensilsCrossed className="h-5 w-5" />
              Menu Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{menuItems.length}</p>
            <p className="text-sm text-muted-foreground">
              {menuItems.filter((i) => i.available).length} available
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutDashboard className="h-5 w-5" />
              Tables
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{tables.length}</p>
            <p className="text-sm text-muted-foreground">
              {tables.filter((t) => t.status === "occupied").length} occupied
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{users.length}</p>
            <p className="text-sm text-muted-foreground">Total staff members</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="menu" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="menu" data-testid="tab-menu">Menu</TabsTrigger>
          <TabsTrigger value="tables" data-testid="tab-tables">Tables</TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">Users</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="menu" className="mt-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Menu Management</h2>
            <Dialog open={menuDialogOpen} onOpenChange={setMenuDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  onClick={() => {
                    setEditingItem(null);
                    setImagePreview("");
                    menuForm.reset({
                      name: "",
                      category: "mains",
                      price: "0.00",
                      description: "",
                      imageUrl: "",
                      available: true,
                    });
                  }}
                  data-testid="button-add-menu-item"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Menu Item
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh]">
                <DialogHeader>
                  <DialogTitle>
                    {editingItem ? "Edit Menu Item" : "Add Menu Item"}
                  </DialogTitle>
                  <DialogDescription>
                    {editingItem ? "Update" : "Create a new"} menu item
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[calc(90vh-200px)] pr-4">
                  <Form {...menuForm}>
                    <form onSubmit={menuForm.handleSubmit(handleMenuSubmit)} className="space-y-4">
                    <FormField
                      control={menuForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-menu-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={menuForm.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-menu-category">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="appetizers">Appetizers</SelectItem>
                              <SelectItem value="mains">Mains</SelectItem>
                              <SelectItem value="drinks">Drinks</SelectItem>
                              <SelectItem value="desserts">Desserts</SelectItem>
                              <SelectItem value="specials">Chef's Specials</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={menuForm.control}
                      name="price"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Price</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" {...field} data-testid="input-menu-price" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={menuForm.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Textarea {...field} data-testid="input-menu-description" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={menuForm.control}
                      name="imageUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Image Upload</FormLabel>
                          <FormControl>
                            <div className="space-y-3">
                              <Input
                                type="file"
                                accept="image/*"
                                onChange={handleImageUpload}
                                data-testid="input-menu-image-upload"
                              />
                              {(imagePreview || field.value) && (
                                <div className="relative w-full max-w-xs">
                                  <img
                                    src={imagePreview || field.value}
                                    alt="Preview"
                                    className="w-full h-40 object-cover rounded-md border"
                                  />
                                </div>
                              )}
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={menuForm.control}
                      name="available"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-md border p-4">
                          <div>
                            <FormLabel>Available</FormLabel>
                            <p className="text-sm text-muted-foreground">
                              Make this item available for ordering
                            </p>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-menu-available"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                      <DialogFooter>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setMenuDialogOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          disabled={createMenuItemMutation.isPending || updateMenuItemMutation.isPending}
                          data-testid="button-save-menu-item"
                        >
                          {editingItem ? "Update" : "Create"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {menuItems.map((item) => (
                    <TableRow key={item.id} data-testid={`row-menu-${item.id}`}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="capitalize">{item.category}</TableCell>
                      <TableCell>${item.price}</TableCell>
                      <TableCell>
                        <Badge variant={item.available ? "default" : "secondary"}>
                          {item.available ? "Available" : "Unavailable"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditMenuItem(item)}
                          data-testid={`button-edit-menu-${item.id}`}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMenuItemMutation.mutate(item.id)}
                          data-testid={`button-delete-menu-${item.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tables" className="mt-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Table Management</h2>
            <Dialog open={tableDialogOpen} onOpenChange={setTableDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  onClick={() => tableForm.reset()}
                  data-testid="button-add-table"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Table
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Table</DialogTitle>
                  <DialogDescription>Create a new table</DialogDescription>
                </DialogHeader>
                <Form {...tableForm}>
                  <form
                    onSubmit={tableForm.handleSubmit((data) => {
                      const qrCode = `table-${data.number}-${Date.now()}`;
                      createTableMutation.mutate({ ...data, qrCode });
                    })}
                    className="space-y-4"
                  >
                    <FormField
                      control={tableForm.control}
                      name="number"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Table Number</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value))}
                              data-testid="input-table-number"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={tableForm.control}
                      name="capacity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Capacity</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value))}
                              data-testid="input-table-capacity"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setTableDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={createTableMutation.isPending}
                        data-testid="button-save-table"
                      >
                        Create
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tables.map((table) => (
              <Card key={table.id} data-testid={`card-admin-table-${table.id}`}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Table {table.number}</CardTitle>
                    <Badge>{table.status}</Badge>
                  </div>
                  <CardDescription>Capacity: {table.capacity} guests</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => handleGenerateQR(table)}
                    data-testid={`button-generate-qr-${table.id}`}
                  >
                    <QrCode className="h-4 w-4 mr-2" />
                    Generate QR Code
                  </Button>
                  <Button
                    className="w-full"
                    variant="ghost"
                    onClick={() => deleteTableMutation.mutate(table.id)}
                    data-testid={`button-delete-table-${table.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="users" className="mt-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">User Management</h2>
            <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  onClick={() => userForm.reset()}
                  data-testid="button-add-user"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add User
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add User</DialogTitle>
                  <DialogDescription>Create a new staff member</DialogDescription>
                </DialogHeader>
                <Form {...userForm}>
                  <form
                    onSubmit={userForm.handleSubmit((data) => createUserMutation.mutate(data))}
                    className="space-y-4"
                  >
                    <FormField
                      control={userForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-user-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={userForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-user-username" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={userForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input type="password" {...field} data-testid="input-user-password" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={userForm.control}
                      name="role"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Role</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-user-role">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="waiter">Waiter</SelectItem>
                              <SelectItem value="kitchen">Kitchen</SelectItem>
                              <SelectItem value="cashier">Cashier</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setUserDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={createUserMutation.isPending}
                        data-testid="button-save-user"
                      >
                        Create
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.filter(u => u.globalRole !== "super_admin").map((user) => (
                    <TableRow key={user.id} data-testid={`row-user-${user.id}`}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell>{user.username}</TableCell>
                      <TableCell>{user.email || "-"}</TableCell>
                      <TableCell>
                        <Badge className="capitalize">{user.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={user.isActive}
                            onCheckedChange={(checked) => 
                              toggleUserActiveMutation.mutate({ id: user.id, isActive: checked })
                            }
                            disabled={user.id === currentUserId || toggleUserActiveMutation.isPending}
                            data-testid={`switch-user-active-${user.id}`}
                          />
                          <Badge variant={user.isActive ? "default" : "secondary"}>
                            {user.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        {user.lastLoginAt 
                          ? format(new Date(user.lastLoginAt), "MMM d, yyyy HH:mm") 
                          : "Never"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEditUser(user)}
                            data-testid={`button-edit-user-${user.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleResetPassword(user)}
                            data-testid={`button-reset-password-${user.id}`}
                          >
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={user.id === currentUserId}
                                data-testid={`button-delete-user-${user.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete User</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete user "{user.name}"? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteUserMutation.mutate(user.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Dialog open={editUserDialogOpen} onOpenChange={setEditUserDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit User</DialogTitle>
                <DialogDescription>
                  Update user information for {editingUser?.name}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Name</Label>
                  <Input
                    id="edit-name"
                    value={editUserForm.name}
                    onChange={(e) => setEditUserForm(prev => ({ ...prev, name: e.target.value }))}
                    data-testid="input-edit-user-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={editUserForm.email}
                    onChange={(e) => setEditUserForm(prev => ({ ...prev, email: e.target.value }))}
                    data-testid="input-edit-user-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-role">Role</Label>
                  <Select 
                    value={editUserForm.role} 
                    onValueChange={(value: "admin" | "waiter" | "kitchen" | "cashier") => 
                      setEditUserForm(prev => ({ ...prev, role: value }))
                    }
                  >
                    <SelectTrigger data-testid="select-edit-user-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="waiter">Waiter</SelectItem>
                      <SelectItem value="kitchen">Kitchen</SelectItem>
                      <SelectItem value="cashier">Cashier</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditUserDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleEditUserSubmit}
                  disabled={updateUserMutation.isPending}
                  data-testid="button-save-edit-user"
                >
                  {updateUserMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={resetPasswordDialogOpen} onOpenChange={setResetPasswordDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reset Password</DialogTitle>
                <DialogDescription>
                  Enter a new password for {editingUser?.name}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (min 6 characters)"
                    data-testid="input-new-password"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setResetPasswordDialogOpen(false);
                    setNewPassword("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleResetPasswordSubmit}
                  disabled={resetPasswordMutation.isPending || newPassword.length < 6}
                  data-testid="button-confirm-reset-password"
                >
                  {resetPasswordMutation.isPending ? "Resetting..." : "Reset Password"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="settings" className="mt-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Organization Settings
                </CardTitle>
                <CardDescription>
                  Update your organization's information and branding
                </CardDescription>
              </CardHeader>
              <CardContent>
                {orgSettingsLoading ? (
                  <p className="text-muted-foreground">Loading settings...</p>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="businessName">Business Name</Label>
                      <Input
                        id="businessName"
                        value={settingsForm.name}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Enter business name"
                        data-testid="input-settings-name"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="slogan">Slogan / Tagline</Label>
                      <Input
                        id="slogan"
                        value={settingsForm.slogan}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, slogan: e.target.value }))}
                        placeholder="Enter your restaurant's slogan or tagline"
                        data-testid="input-settings-slogan"
                      />
                      <p className="text-xs text-muted-foreground">A catchy phrase that represents your restaurant</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea
                        id="description"
                        value={settingsForm.description}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, description: e.target.value }))}
                        placeholder="Describe your business"
                        data-testid="input-settings-description"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone Number</Label>
                      <Input
                        id="phone"
                        value={settingsForm.phone}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="Enter phone number"
                        data-testid="input-settings-phone"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="address">Address</Label>
                      <Textarea
                        id="address"
                        value={settingsForm.address}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, address: e.target.value }))}
                        placeholder="Enter business address"
                        data-testid="input-settings-address"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="businessHours">Business Hours</Label>
                      <Textarea
                        id="businessHours"
                        value={settingsForm.businessHours}
                        onChange={(e) => setSettingsForm(prev => ({ ...prev, businessHours: e.target.value }))}
                        placeholder="e.g., Mon-Fri: 9AM-10PM, Sat-Sun: 10AM-11PM"
                        data-testid="input-settings-hours"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="logo">Logo</Label>
                      <Input
                        id="logo"
                        type="file"
                        accept="image/*"
                        onChange={handleSettingsLogoUpload}
                        data-testid="input-settings-logo"
                      />
                      {(settingsLogoPreview || settingsForm.logoUrl) && (
                        <div className="relative w-32 h-32">
                          <img
                            src={settingsLogoPreview || settingsForm.logoUrl}
                            alt="Logo Preview"
                            className="w-full h-full object-contain rounded-md border"
                          />
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="primaryColor">Primary Color</Label>
                        <div className="flex gap-2">
                          <Input
                            id="primaryColor"
                            type="color"
                            value={settingsForm.primaryColor}
                            onChange={(e) => setSettingsForm(prev => ({ ...prev, primaryColor: e.target.value }))}
                            className="w-12 h-9 p-1 cursor-pointer"
                            data-testid="input-settings-primary-color"
                          />
                          <Input
                            type="text"
                            value={settingsForm.primaryColor}
                            onChange={(e) => setSettingsForm(prev => ({ ...prev, primaryColor: e.target.value }))}
                            placeholder="#8B5A2B"
                            className="flex-1"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="secondaryColor">Secondary Color</Label>
                        <div className="flex gap-2">
                          <Input
                            id="secondaryColor"
                            type="color"
                            value={settingsForm.secondaryColor}
                            onChange={(e) => setSettingsForm(prev => ({ ...prev, secondaryColor: e.target.value }))}
                            className="w-12 h-9 p-1 cursor-pointer"
                            data-testid="input-settings-secondary-color"
                          />
                          <Input
                            type="text"
                            value={settingsForm.secondaryColor}
                            onChange={(e) => setSettingsForm(prev => ({ ...prev, secondaryColor: e.target.value }))}
                            placeholder="#FFF8E7"
                            className="flex-1"
                          />
                        </div>
                      </div>
                    </div>

                    <Button 
                      onClick={handleSettingsSave}
                      disabled={updateSettingsMutation.isPending}
                      className="w-full"
                      data-testid="button-save-settings"
                    >
                      {updateSettingsMutation.isPending ? "Saving..." : "Save Settings"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Subscription Status
                </CardTitle>
                <CardDescription>
                  Your current subscription plan and status
                </CardDescription>
              </CardHeader>
              <CardContent>
                {subscriptionLoading ? (
                  <p className="text-muted-foreground">Loading subscription...</p>
                ) : subscriptionStatus?.hasActiveSubscription ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Plan</span>
                      <Badge variant="default">
                        {subscriptionStatus.subscription?.plan.name}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <Badge variant={subscriptionStatus.subscription?.status === "active" ? "default" : "secondary"}>
                        {subscriptionStatus.subscription?.status}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Start Date</span>
                      <span className="text-sm font-medium">
                        {subscriptionStatus.subscription?.startDate 
                          ? new Date(subscriptionStatus.subscription.startDate).toLocaleDateString()
                          : "-"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">End Date</span>
                      <span className="text-sm font-medium">
                        {subscriptionStatus.subscription?.endDate 
                          ? new Date(subscriptionStatus.subscription.endDate).toLocaleDateString()
                          : "-"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Days Remaining</span>
                      <Badge 
                        variant={subscriptionStatus.subscription?.daysRemaining && subscriptionStatus.subscription.daysRemaining <= 7 ? "destructive" : "default"}
                        className="flex items-center gap-1"
                      >
                        {subscriptionStatus.subscription?.daysRemaining && subscriptionStatus.subscription.daysRemaining <= 7 && (
                          <AlertTriangle className="h-3 w-3" />
                        )}
                        {subscriptionStatus.subscription?.daysRemaining ?? 0} days
                      </Badge>
                    </div>

                    {subscriptionStatus.message && (
                      <div className="p-3 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                        <p className="text-sm text-yellow-800 dark:text-yellow-200 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          {subscriptionStatus.message}
                        </p>
                        {subscriptionStatus.contactEmail && (
                          <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                            Contact: {subscriptionStatus.contactEmail}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-4 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                    <p className="text-sm text-red-800 dark:text-red-200 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" />
                      No active subscription
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-400 mt-2">
                      {subscriptionStatus?.message || "Please contact the app owner to renew your subscription."}
                    </p>
                    {subscriptionStatus?.contactEmail && (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                        Contact: {subscriptionStatus.contactEmail}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={!!qrCodeDataUrl} onOpenChange={() => setQrCodeDataUrl("")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Table QR Code</DialogTitle>
            <DialogDescription>
              Scan this QR code to access the menu
            </DialogDescription>
          </DialogHeader>
          {qrCodeDataUrl && (
            <div className="flex flex-col items-center gap-4">
              <img src={qrCodeDataUrl} alt="QR Code" className="w-64 h-64" />
              <Button onClick={handleDownloadQR} data-testid="button-download-qr">
                <Download className="h-4 w-4 mr-2" />
                Download QR Code
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

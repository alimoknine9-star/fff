import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Edit, Trash2, QrCode, Download, Users, Clock, Ticket, Phone, PhoneCall, SkipForward, X, Settings, Loader2, RefreshCw, BarChart3, TrendingUp, UserX, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useWebSocket } from "@/hooks/use-websocket";
import { z } from "zod";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface Queue {
  id: number;
  organizationId: number;
  name: string;
  description: string | null;
  status: "active" | "paused" | "closed";
  currentTicket: number;
  nextTicket: number;
  avgServiceTime: number;
  qrCode: string;
  createdAt: string;
  updatedAt: string;
  waitingCount?: number;
  qrCodeImage?: string;
}

interface QueueTicket {
  id: number;
  queueId: number;
  ticketNumber: number;
  customerName: string | null;
  customerPhone: string | null;
  partySize: number;
  status: "waiting" | "called" | "serving" | "completed" | "cancelled" | "no_show";
  estimatedWaitMinutes: number | null;
  calledAt: string | null;
  servedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface QueueAnalytics {
  today: {
    totalServed: number;
    totalNoShows: number;
    totalCancelled: number;
    avgWaitTime: number;
  };
  weekly: {
    peakHours: { hour: number; count: number }[];
    dailyServed: { date: string; count: number }[];
  };
  allTime: {
    totalServed: number;
    avgWaitTime: number;
  };
}

const queueFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  avgServiceTime: z.number().min(1).default(5),
  status: z.enum(["active", "paused", "closed"]).default("active"),
});

type QueueFormData = z.infer<typeof queueFormSchema>;

const ticketStatuses = [
  { value: "all", label: "All" },
  { value: "waiting", label: "Waiting" },
  { value: "called", label: "Called" },
  { value: "serving", label: "Serving" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "no_show", label: "No Show" },
];

const getStatusBadgeVariant = (status: string) => {
  switch (status) {
    case "waiting":
      return "secondary";
    case "called":
      return "default";
    case "serving":
      return "default";
    case "completed":
      return "outline";
    case "cancelled":
      return "destructive";
    case "no_show":
      return "destructive";
    default:
      return "secondary";
  }
};

const getQueueStatusBadgeVariant = (status: string) => {
  switch (status) {
    case "active":
      return "default";
    case "paused":
      return "secondary";
    case "closed":
      return "destructive";
    default:
      return "secondary";
  }
};

export default function QueueDashboard() {
  const { toast } = useToast();
  useWebSocket();

  const [queueDialogOpen, setQueueDialogOpen] = useState(false);
  const [editingQueue, setEditingQueue] = useState<Queue | null>(null);
  const [selectedQueue, setSelectedQueue] = useState<Queue | null>(null);
  const [statusFilter, setStatusFilter] = useState("waiting");
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrCodeData, setQrCodeData] = useState<{ name: string; qrCodeImage: string; qrCode: string } | null>(null);
  const [mainTab, setMainTab] = useState<"operations" | "analytics">("operations");

  const { data: queues = [], isLoading: queuesLoading, refetch: refetchQueues } = useQuery<Queue[]>({
    queryKey: ["/api/queues"],
    refetchInterval: 10000,
  });

  const { data: selectedQueueDetails, refetch: refetchQueueDetails } = useQuery<Queue>({
    queryKey: ["/api/queues", selectedQueue?.id],
    enabled: !!selectedQueue?.id,
    refetchInterval: 5000,
  });

  const { data: tickets = [], refetch: refetchTickets } = useQuery<QueueTicket[]>({
    queryKey: ["/api/queues", selectedQueue?.id, "tickets", statusFilter !== "all" ? `?status=${statusFilter}` : ""],
    queryFn: async () => {
      if (!selectedQueue?.id) return [];
      const url = statusFilter !== "all" 
        ? `/api/queues/${selectedQueue.id}/tickets?status=${statusFilter}`
        : `/api/queues/${selectedQueue.id}/tickets`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch tickets");
      return res.json();
    },
    enabled: !!selectedQueue?.id,
    refetchInterval: 5000,
  });

  const { data: analytics, isLoading: analyticsLoading, error: analyticsError } = useQuery<QueueAnalytics>({
    queryKey: ["/api/queues", selectedQueue?.id, "analytics"],
    queryFn: async () => {
      if (!selectedQueue?.id) return null;
      const res = await fetch(`/api/queues/${selectedQueue.id}/analytics`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch analytics");
      return res.json();
    },
    enabled: !!selectedQueue?.id && mainTab === "analytics",
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (queues.length > 0 && !selectedQueue) {
      setSelectedQueue(queues[0]);
    }
  }, [queues, selectedQueue]);

  const queueForm = useForm<QueueFormData>({
    resolver: zodResolver(queueFormSchema),
    defaultValues: {
      name: "",
      description: "",
      avgServiceTime: 5,
      status: "active",
    },
  });

  useEffect(() => {
    if (editingQueue) {
      queueForm.reset({
        name: editingQueue.name,
        description: editingQueue.description || "",
        avgServiceTime: editingQueue.avgServiceTime,
        status: editingQueue.status,
      });
    } else {
      queueForm.reset({
        name: "",
        description: "",
        avgServiceTime: 5,
        status: "active",
      });
    }
  }, [editingQueue, queueForm]);

  const createQueueMutation = useMutation({
    mutationFn: async (data: QueueFormData) => {
      const res = await apiRequest("POST", "/api/queues", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queues"] });
      setQueueDialogOpen(false);
      queueForm.reset();
      toast({ title: "Queue created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create queue", description: error.message, variant: "destructive" });
    },
  });

  const updateQueueMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<QueueFormData> }) => {
      const res = await apiRequest("PATCH", `/api/queues/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queues"] });
      setQueueDialogOpen(false);
      setEditingQueue(null);
      queueForm.reset();
      toast({ title: "Queue updated successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update queue", description: error.message, variant: "destructive" });
    },
  });

  const deleteQueueMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/queues/${id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queues"] });
      if (selectedQueue?.id === editingQueue?.id) {
        setSelectedQueue(null);
      }
      toast({ title: "Queue deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete queue", description: error.message, variant: "destructive" });
    },
  });

  const callNextMutation = useMutation({
    mutationFn: async (queueId: number) => {
      const res = await apiRequest("POST", `/api/queues/${queueId}/call-next`, {});
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/queues"] });
      refetchTickets();
      refetchQueueDetails();
      toast({ title: `Called ticket #${data.ticketNumber}` });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to call next", description: error.message, variant: "destructive" });
    },
  });

  const updateTicketStatusMutation = useMutation({
    mutationFn: async ({ queueId, ticketId, status }: { queueId: number; ticketId: number; status: string }) => {
      const res = await apiRequest("PATCH", `/api/queues/${queueId}/tickets/${ticketId}/status`, { status });
      return res.json();
    },
    onSuccess: () => {
      refetchTickets();
      refetchQueueDetails();
      toast({ title: "Ticket status updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update ticket", description: error.message, variant: "destructive" });
    },
  });

  const skipTicketMutation = useMutation({
    mutationFn: async ({ queueId, ticketId }: { queueId: number; ticketId: number }) => {
      const res = await apiRequest("POST", `/api/queues/${queueId}/skip/${ticketId}`, {});
      return res.json();
    },
    onSuccess: () => {
      refetchTickets();
      refetchQueueDetails();
      toast({ title: "Ticket marked as no-show" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to skip ticket", description: error.message, variant: "destructive" });
    },
  });

  const cancelTicketMutation = useMutation({
    mutationFn: async ({ queueId, ticketId }: { queueId: number; ticketId: number }) => {
      await apiRequest("DELETE", `/api/queues/${queueId}/tickets/${ticketId}`, {});
    },
    onSuccess: () => {
      refetchTickets();
      refetchQueueDetails();
      toast({ title: "Ticket cancelled" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to cancel ticket", description: error.message, variant: "destructive" });
    },
  });

  const handleQueueSubmit = (data: QueueFormData) => {
    if (editingQueue) {
      updateQueueMutation.mutate({ id: editingQueue.id, data });
    } else {
      createQueueMutation.mutate(data);
    }
  };

  const handleEditQueue = (queue: Queue) => {
    setEditingQueue(queue);
    setQueueDialogOpen(true);
  };

  const handleShowQR = async (queue: Queue) => {
    try {
      const res = await fetch(`/api/queues/${queue.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch QR code");
      const data = await res.json();
      setQrCodeData({
        name: queue.name,
        qrCodeImage: data.qrCodeImage,
        qrCode: queue.qrCode,
      });
      setQrDialogOpen(true);
    } catch (error) {
      toast({ title: "Failed to load QR code", variant: "destructive" });
    }
  };

  const handleDownloadQR = () => {
    if (!qrCodeData) return;
    const link = document.createElement("a");
    link.download = `queue-${qrCodeData.name.replace(/\s+/g, "-")}-qr.png`;
    link.href = qrCodeData.qrCodeImage;
    link.click();
  };

  const waitingCount = tickets.filter(t => t.status === "waiting").length;
  const currentTicket = selectedQueueDetails?.currentTicket || selectedQueue?.currentTicket || 0;

  if (queuesLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Queue Management</h1>
          <p className="text-muted-foreground">Manage your queues and serve customers</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => refetchQueues()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Dialog open={queueDialogOpen} onOpenChange={(open) => {
            setQueueDialogOpen(open);
            if (!open) setEditingQueue(null);
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Queue
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingQueue ? "Edit Queue" : "Create New Queue"}</DialogTitle>
                <DialogDescription>
                  {editingQueue ? "Update the queue settings" : "Set up a new queue for your customers"}
                </DialogDescription>
              </DialogHeader>
              <Form {...queueForm}>
                <form onSubmit={queueForm.handleSubmit(handleQueueSubmit)} className="space-y-4">
                  <FormField
                    control={queueForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="Main Queue" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={queueForm.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Optional description" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={queueForm.control}
                    name="avgServiceTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Average Service Time (minutes)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 5)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={queueForm.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="paused">Paused</SelectItem>
                            <SelectItem value="closed">Closed</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button type="submit" disabled={createQueueMutation.isPending || updateQueueMutation.isPending}>
                      {(createQueueMutation.isPending || updateQueueMutation.isPending) && (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      )}
                      {editingQueue ? "Update Queue" : "Create Queue"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {queues.length === 0 ? (
        <Card className="p-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <Ticket className="h-12 w-12 text-muted-foreground" />
            <div>
              <h3 className="text-lg font-semibold">No Queues Yet</h3>
              <p className="text-muted-foreground">Create your first queue to start managing customers</p>
            </div>
            <Button onClick={() => setQueueDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Queue
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "operations" | "analytics")}>
            <TabsList className="mb-4">
              <TabsTrigger value="operations" className="gap-2">
                <Ticket className="h-4 w-4" />
                Queue Operations
              </TabsTrigger>
              <TabsTrigger value="analytics" className="gap-2">
                <BarChart3 className="h-4 w-4" />
                Analytics
              </TabsTrigger>
            </TabsList>

            <TabsContent value="operations">
              <Tabs
                value={selectedQueue?.id.toString() || queues[0]?.id.toString()}
                onValueChange={(value) => {
                  const queue = queues.find((q) => q.id.toString() === value);
                  if (queue) setSelectedQueue(queue);
                }}
              >
                <TabsList className="mb-4">
                  {queues.map((queue) => (
                    <TabsTrigger key={queue.id} value={queue.id.toString()} className="gap-2">
                      {queue.name}
                      <Badge variant={getQueueStatusBadgeVariant(queue.status)} className="ml-1">
                        {queue.status}
                      </Badge>
                    </TabsTrigger>
                  ))}
                </TabsList>

                {queues.map((queue) => (
                  <TabsContent key={queue.id} value={queue.id.toString()} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Now Serving
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl font-bold text-primary">
                      #{currentTicket || "-"}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <Users className="h-4 w-4 inline mr-1" />
                      Waiting
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl font-bold">{waitingCount}</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      <Clock className="h-4 w-4 inline mr-1" />
                      Est. Wait
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-4xl font-bold">
                      {waitingCount * (selectedQueueDetails?.avgServiceTime || queue.avgServiceTime)}
                      <span className="text-lg font-normal text-muted-foreground ml-1">min</span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      Queue Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Badge variant={getQueueStatusBadgeVariant(queue.status)} className="text-lg px-3 py-1">
                      {queue.status.charAt(0).toUpperCase() + queue.status.slice(1)}
                    </Badge>
                  </CardContent>
                </Card>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="lg"
                  onClick={() => callNextMutation.mutate(queue.id)}
                  disabled={callNextMutation.isPending || queue.status !== "active"}
                >
                  {callNextMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <PhoneCall className="h-4 w-4 mr-2" />
                  )}
                  Call Next
                </Button>
                <Button variant="outline" onClick={() => handleShowQR(queue)}>
                  <QrCode className="h-4 w-4 mr-2" />
                  Show QR Code
                </Button>
                <Button variant="outline" onClick={() => handleEditQueue(queue)}>
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="text-destructive">
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete Queue?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete the queue "{queue.name}" and all its tickets. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteQueueMutation.mutate(queue.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>Tickets</CardTitle>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Filter by status" />
                      </SelectTrigger>
                      <SelectContent>
                        {ticketStatuses.map((status) => (
                          <SelectItem key={status.value} value={status.value}>
                            {status.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ticket #</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead>Party Size</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tickets.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              No tickets found
                            </TableCell>
                          </TableRow>
                        ) : (
                          tickets.map((ticket) => (
                            <TableRow key={ticket.id}>
                              <TableCell className="font-mono font-bold">
                                #{ticket.ticketNumber}
                              </TableCell>
                              <TableCell>
                                <div>
                                  {ticket.customerName || "Anonymous"}
                                  {ticket.customerPhone && (
                                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                                      <Phone className="h-3 w-3" />
                                      {ticket.customerPhone}
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>{ticket.partySize}</TableCell>
                              <TableCell>
                                <Badge variant={getStatusBadgeVariant(ticket.status)}>
                                  {ticket.status.replace("_", " ")}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {new Date(ticket.createdAt).toLocaleTimeString()}
                              </TableCell>
                              <TableCell>
                                <div className="flex justify-end gap-1">
                                  {ticket.status === "waiting" && (
                                    <>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          updateTicketStatusMutation.mutate({
                                            queueId: queue.id,
                                            ticketId: ticket.id,
                                            status: "called",
                                          })
                                        }
                                      >
                                        <PhoneCall className="h-3 w-3 mr-1" />
                                        Call
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          skipTicketMutation.mutate({
                                            queueId: queue.id,
                                            ticketId: ticket.id,
                                          })
                                        }
                                      >
                                        <SkipForward className="h-3 w-3 mr-1" />
                                        Skip
                                      </Button>
                                    </>
                                  )}
                                  {ticket.status === "called" && (
                                    <>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          updateTicketStatusMutation.mutate({
                                            queueId: queue.id,
                                            ticketId: ticket.id,
                                            status: "serving",
                                          })
                                        }
                                      >
                                        Start Serving
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          skipTicketMutation.mutate({
                                            queueId: queue.id,
                                            ticketId: ticket.id,
                                          })
                                        }
                                      >
                                        <SkipForward className="h-3 w-3 mr-1" />
                                        No Show
                                      </Button>
                                    </>
                                  )}
                                  {ticket.status === "serving" && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        updateTicketStatusMutation.mutate({
                                          queueId: queue.id,
                                          ticketId: ticket.id,
                                          status: "completed",
                                        })
                                      }
                                    >
                                      Complete
                                    </Button>
                                  )}
                                  {(ticket.status === "waiting" || ticket.status === "called") && (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="sm" className="text-destructive">
                                          <X className="h-3 w-3" />
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>Cancel Ticket?</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            This will remove ticket #{ticket.ticketNumber} from the queue.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Keep</AlertDialogCancel>
                                          <AlertDialogAction
                                            onClick={() =>
                                              cancelTicketMutation.mutate({
                                                queueId: queue.id,
                                                ticketId: ticket.id,
                                              })
                                            }
                                            className="bg-destructive text-destructive-foreground"
                                          >
                                            Cancel Ticket
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </CardContent>
              </Card>
                  </TabsContent>
                ))}
              </Tabs>
            </TabsContent>

            <TabsContent value="analytics" className="space-y-6">
              <Tabs
                value={selectedQueue?.id.toString() || queues[0]?.id.toString()}
                onValueChange={(value) => {
                  const queue = queues.find((q) => q.id.toString() === value);
                  if (queue) setSelectedQueue(queue);
                }}
              >
                <TabsList className="mb-4">
                  {queues.map((queue) => (
                    <TabsTrigger key={queue.id} value={queue.id.toString()} className="gap-2">
                      {queue.name}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {queues.map((queue) => (
                  <TabsContent key={queue.id} value={queue.id.toString()} className="space-y-6">
                    {analyticsLoading ? (
                      <div className="flex items-center justify-center h-64">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <span className="ml-2 text-muted-foreground">Loading analytics...</span>
                      </div>
                    ) : analyticsError ? (
                      <Card className="p-8 text-center">
                        <div className="text-destructive">Failed to load analytics. Please try again.</div>
                      </Card>
                    ) : analytics ? (
                      <>
                        <div>
                          <h2 className="text-xl font-semibold mb-4">Today's Statistics</h2>
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                  <Users className="h-4 w-4" />
                                  Customers Served
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="text-4xl font-bold text-green-600">
                                  {analytics.today.totalServed}
                                </div>
                              </CardContent>
                            </Card>

                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                  <Clock className="h-4 w-4" />
                                  Average Wait Time
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="text-4xl font-bold text-blue-600">
                                  {analytics.today.avgWaitTime}
                                  <span className="text-lg font-normal text-muted-foreground ml-1">min</span>
                                </div>
                              </CardContent>
                            </Card>

                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                  <UserX className="h-4 w-4" />
                                  No-shows
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="text-4xl font-bold text-orange-600">
                                  {analytics.today.totalNoShows}
                                </div>
                              </CardContent>
                            </Card>

                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                  <XCircle className="h-4 w-4" />
                                  Cancellations
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="text-4xl font-bold text-red-600">
                                  {analytics.today.totalCancelled}
                                </div>
                              </CardContent>
                            </Card>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <Card>
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2">
                                <TrendingUp className="h-5 w-5" />
                                Customers Served (Last 7 Days)
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              {analytics.weekly.dailyServed.length > 0 ? (
                                <ResponsiveContainer width="100%" height={300}>
                                  <BarChart data={analytics.weekly.dailyServed.map(d => ({
                                    date: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
                                    count: d.count
                                  }))}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                    <XAxis dataKey="date" className="text-xs" />
                                    <YAxis allowDecimals={false} />
                                    <Tooltip 
                                      contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                                    />
                                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Customers" />
                                  </BarChart>
                                </ResponsiveContainer>
                              ) : (
                                <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                                  No data available for the past 7 days
                                </div>
                              )}
                            </CardContent>
                          </Card>

                          <Card>
                            <CardHeader>
                              <CardTitle className="flex items-center gap-2">
                                <Clock className="h-5 w-5" />
                                Peak Hours (Weekly)
                              </CardTitle>
                            </CardHeader>
                            <CardContent>
                              {analytics.weekly.peakHours.length > 0 ? (
                                <ResponsiveContainer width="100%" height={300}>
                                  <LineChart data={
                                    Array.from({ length: 17 }, (_, i) => {
                                      const hour = i + 6;
                                      const found = analytics.weekly.peakHours.find(h => h.hour === hour);
                                      return {
                                        hour: `${hour > 12 ? hour - 12 : hour}${hour >= 12 ? 'PM' : 'AM'}`,
                                        count: found?.count || 0
                                      };
                                    })
                                  }>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                    <XAxis dataKey="hour" className="text-xs" />
                                    <YAxis allowDecimals={false} />
                                    <Tooltip 
                                      contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                                    />
                                    <Line 
                                      type="monotone" 
                                      dataKey="count" 
                                      stroke="hsl(var(--primary))" 
                                      strokeWidth={2}
                                      dot={{ fill: 'hsl(var(--primary))' }}
                                      name="Customers"
                                    />
                                  </LineChart>
                                </ResponsiveContainer>
                              ) : (
                                <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                                  No peak hours data available
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        </div>

                        <div>
                          <h2 className="text-xl font-semibold mb-4">All-Time Statistics</h2>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                  <Users className="h-4 w-4" />
                                  Total Customers Served
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="text-4xl font-bold">
                                  {analytics.allTime.totalServed.toLocaleString()}
                                </div>
                              </CardContent>
                            </Card>

                            <Card>
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                  <Clock className="h-4 w-4" />
                                  Overall Average Wait Time
                                </CardTitle>
                              </CardHeader>
                              <CardContent>
                                <div className="text-4xl font-bold">
                                  {analytics.allTime.avgWaitTime}
                                  <span className="text-lg font-normal text-muted-foreground ml-1">min</span>
                                </div>
                              </CardContent>
                            </Card>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-center text-muted-foreground py-8">
                        Select a queue to view analytics
                      </div>
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </TabsContent>
          </Tabs>
        </>
      )}

      <Dialog open={qrDialogOpen} onOpenChange={setQrDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Queue QR Code</DialogTitle>
            <DialogDescription>
              Scan this code to join "{qrCodeData?.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qrCodeData?.qrCodeImage && (
              <img
                src={qrCodeData.qrCodeImage}
                alt="Queue QR Code"
                className="w-64 h-64 border rounded-lg"
              />
            )}
            <p className="text-sm text-muted-foreground text-center">
              Customers can scan this QR code to join your queue
            </p>
            <p className="text-xs text-muted-foreground font-mono">
              {qrCodeData?.qrCode && `${window.location.origin}/queue/${qrCodeData.qrCode}`}
            </p>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setQrDialogOpen(false)}>
              Close
            </Button>
            <Button onClick={handleDownloadQR}>
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

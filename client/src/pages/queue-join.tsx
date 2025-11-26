import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/hooks/use-websocket";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Users, Clock, Ticket, AlertCircle, CheckCircle2 } from "lucide-react";

interface QueueInfo {
  id: number;
  name: string;
  status: "active" | "paused" | "closed";
  currentTicket: number;
  estimatedWaitMinutes: number;
  totalWaiting: number;
}

interface TicketInfo {
  id: number;
  ticketNumber: number;
  position: number;
  estimatedWaitMinutes: number;
  currentTicket: number;
  status: "waiting" | "called" | "serving" | "completed" | "cancelled";
  queueName: string;
}

interface JoinQueueData {
  customerName?: string;
  phoneNumber?: string;
  partySize: number;
}

export default function QueueJoin() {
  const { qrCode } = useParams<{ qrCode: string }>();
  const { toast } = useToast();
  useWebSocket();

  const [customerName, setCustomerName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [partySize, setPartySize] = useState(1);
  const [ticket, setTicket] = useState<TicketInfo | null>(null);

  const { data: queueInfo, isLoading, error, refetch: refetchQueueInfo } = useQuery<QueueInfo>({
    queryKey: ["/api/public/queue", qrCode],
    queryFn: async () => {
      const res = await fetch(`/api/public/queue/${qrCode}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json();
    },
    enabled: !!qrCode,
    refetchInterval: ticket ? 5000 : false,
  });

  const { data: ticketStatus, refetch: refetchTicket } = useQuery<TicketInfo>({
    queryKey: ["/api/public/ticket", ticket?.id],
    queryFn: async () => {
      const res = await fetch(`/api/public/ticket/${ticket!.id}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json();
    },
    enabled: !!ticket?.id,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (ticketStatus) {
      setTicket(ticketStatus);
    }
  }, [ticketStatus]);

  const joinQueueMutation = useMutation({
    mutationFn: async (data: JoinQueueData) => {
      const res = await fetch(`/api/public/queue/${qrCode}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json();
    },
    onSuccess: (data: TicketInfo) => {
      setTicket(data);
      toast({
        title: "Successfully Joined Queue!",
        description: `Your ticket number is ${data.ticketNumber}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Join Queue",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleJoinQueue = (e: React.FormEvent) => {
    e.preventDefault();
    joinQueueMutation.mutate({
      customerName: customerName || undefined,
      phoneNumber: phoneNumber || undefined,
      partySize,
    });
  };

  if (!qrCode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="text-muted-foreground">
                Invalid QR code. Please scan a valid queue QR code.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">Loading queue information...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center gap-4">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <div>
                <h2 className="text-lg font-semibold mb-2">Queue Not Found</h2>
                <p className="text-muted-foreground">
                  This queue doesn't exist or the QR code has expired.
                </p>
              </div>
              <Button variant="outline" onClick={() => refetchQueueInfo()}>
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (queueInfo && (queueInfo.status === "closed" || queueInfo.status === "paused")) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CardTitle>{queueInfo.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center text-center gap-4">
              <AlertCircle className="h-12 w-12 text-yellow-500" />
              <div>
                <Badge variant={queueInfo.status === "closed" ? "destructive" : "secondary"}>
                  {queueInfo.status === "closed" ? "Queue Closed" : "Queue Paused"}
                </Badge>
                <p className="text-muted-foreground mt-4">
                  {queueInfo.status === "closed" 
                    ? "This queue is currently closed. Please try again later."
                    : "This queue is temporarily paused. Please wait a moment."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (ticket) {
    const progressPercent = ticket.position > 0 
      ? Math.max(0, Math.min(100, ((ticket.currentTicket / ticket.ticketNumber) * 100)))
      : 100;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-xl">{ticket.queueName}</CardTitle>
            <Badge 
              variant={ticket.status === "called" || ticket.status === "serving" ? "default" : "secondary"}
              className="mt-2"
            >
              {ticket.status === "waiting" && "Waiting"}
              {ticket.status === "called" && "You're Being Called!"}
              {ticket.status === "serving" && "Now Serving"}
              {ticket.status === "completed" && "Completed"}
              {ticket.status === "cancelled" && "Cancelled"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-2">Your Ticket Number</p>
              <div className="flex items-center justify-center">
                <div className="bg-primary text-primary-foreground rounded-2xl px-8 py-6 inline-flex flex-col items-center">
                  <Ticket className="h-8 w-8 mb-2" />
                  <span className="text-5xl font-bold">{ticket.ticketNumber}</span>
                </div>
              </div>
            </div>

            {(ticket.status === "waiting" || ticket.status === "called") && (
              <>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Position in Queue</span>
                    <span className="font-semibold">{ticket.position}</span>
                  </div>
                  <Progress value={progressPercent} className="h-2" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Card className="bg-muted">
                    <CardContent className="pt-4 text-center">
                      <Clock className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-2xl font-bold">{ticket.estimatedWaitMinutes}</p>
                      <p className="text-xs text-muted-foreground">minutes wait</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-muted">
                    <CardContent className="pt-4 text-center">
                      <Users className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-2xl font-bold">{ticket.currentTicket}</p>
                      <p className="text-xs text-muted-foreground">now serving</p>
                    </CardContent>
                  </Card>
                </div>

                {ticket.status === "called" && (
                  <div className="bg-primary/10 border border-primary rounded-lg p-4 text-center animate-pulse">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <p className="font-semibold text-primary">It's your turn!</p>
                    <p className="text-sm text-muted-foreground">Please proceed to the counter</p>
                  </div>
                )}
              </>
            )}

            {ticket.status === "completed" && (
              <div className="bg-green-500/10 border border-green-500 rounded-lg p-4 text-center">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                <p className="font-semibold text-green-600">Service Completed</p>
                <p className="text-sm text-muted-foreground">Thank you for your visit!</p>
              </div>
            )}

            {ticket.status === "cancelled" && (
              <div className="bg-destructive/10 border border-destructive rounded-lg p-4 text-center">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 text-destructive" />
                <p className="font-semibold text-destructive">Ticket Cancelled</p>
                <p className="text-sm text-muted-foreground">Your ticket has been cancelled</p>
              </div>
            )}

            <p className="text-xs text-center text-muted-foreground">
              This page updates automatically every 5 seconds
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{queueInfo?.name}</CardTitle>
          <Badge variant="default" className="mt-2">
            Queue Active
          </Badge>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <Card className="bg-muted">
              <CardContent className="pt-4 text-center">
                <Users className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                <p className="text-2xl font-bold">{queueInfo?.totalWaiting || 0}</p>
                <p className="text-xs text-muted-foreground">people waiting</p>
              </CardContent>
            </Card>
            <Card className="bg-muted">
              <CardContent className="pt-4 text-center">
                <Clock className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
                <p className="text-2xl font-bold">{queueInfo?.estimatedWaitMinutes || 0}</p>
                <p className="text-xs text-muted-foreground">min wait</p>
              </CardContent>
            </Card>
          </div>

          <div className="text-center py-2">
            <p className="text-sm text-muted-foreground">
              Now Serving: <span className="font-bold text-foreground text-lg">#{queueInfo?.currentTicket || 0}</span>
            </p>
          </div>

          <form onSubmit={handleJoinQueue} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="customerName">Name (optional)</Label>
              <Input
                id="customerName"
                type="text"
                placeholder="Enter your name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phoneNumber">Phone Number (optional)</Label>
              <Input
                id="phoneNumber"
                type="tel"
                placeholder="Enter your phone number"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="partySize">Party Size</Label>
              <Input
                id="partySize"
                type="number"
                min={1}
                max={20}
                value={partySize}
                onChange={(e) => setPartySize(parseInt(e.target.value) || 1)}
              />
            </div>

            <Button 
              type="submit" 
              className="w-full" 
              size="lg"
              disabled={joinQueueMutation.isPending}
            >
              {joinQueueMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Joining Queue...
                </>
              ) : (
                <>
                  <Ticket className="mr-2 h-5 w-5" />
                  Join Queue
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

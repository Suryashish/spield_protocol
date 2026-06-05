import { motion } from 'framer-motion';
import { 
  LayoutDashboard, 
  BarChart3, 
  Wallet2, 
  Plane,
  ShieldCheck,
  History,
  Settings,
  Search,
  Bell,
  ChevronDown,
  ArrowRight,
  type LucideIcon
} from 'lucide-react';
import logo from '../assets/logo.png';

import { 
  Area, 
  AreaChart, 
  CartesianGrid, 
  ResponsiveContainer, 
  XAxis, 
  YAxis, 
  Tooltip
} from 'recharts';

// Shadcn UI Components
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";

import { cn } from "@/lib/utils";

const chartData = [
  { day: "01", tvl: 45000 },
  { day: "03", tvl: 52000 },
  { day: "05", tvl: 48000 },
  { day: "07", tvl: 61000 },
  { day: "09", tvl: 55000 },
  { day: "11", tvl: 67000 },
  { day: "13", tvl: 72000 },
  { day: "15", tvl: 68000 },
  { day: "17", tvl: 85000 },
  { day: "19", tvl: 78000 },
  { day: "21", tvl: 92000 },
  { day: "23", tvl: 88000 },
  { day: "25", tvl: 96000 },
  { day: "27", tvl: 104000 },
  { day: "29", tvl: 112000 },
  { day: "31", tvl: 124502 },
];

const chartConfig = {
  tvl: {
    label: "TVL",
    color: "var(--primary)",
  },
};

const CustomChart = () => (
  <ChartContainer config={chartConfig} className="h-[240px] w-full">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorTvl" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.1}/>
            <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
        <XAxis 
          dataKey="day" 
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
          dy={10}
        />
        <YAxis hide />
        <Tooltip content={<ChartTooltipContent indicator="line" />} />
        <Area 
          type="monotone" 
          dataKey="tvl" 
          stroke="hsl(var(--primary))" 
          strokeWidth={2}
          fillOpacity={1} 
          fill="url(#colorTvl)" 
        />
      </AreaChart>
    </ResponsiveContainer>
  </ChartContainer>
);

const SidebarIcon = ({ icon: Icon, active = false }: { icon: LucideIcon, active?: boolean }) => (
  <button className={cn(
    "w-10 h-10 flex items-center justify-center rounded-md transition-colors relative",
    active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
  )}>
    <Icon size={18} />
    {active && (
      <motion.div 
        layoutId="sidebar-active"
        className="absolute -left-3 w-1 h-5 bg-primary rounded-r-full"
      />
    )}
  </button>
);

const StatItem = ({ label, value, change, isPositive = true }: { label: string, value: string, change?: string, isPositive?: boolean }) => (
  <div className="flex flex-col gap-0.5 px-4 first:pl-0 last:pr-0 border-r border-border last:border-none">
    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider leading-tight">{label}</span>
    <div className="flex items-baseline gap-2">
      <span className="text-xl font-bold tracking-tight leading-none">{value}</span>
      {change && (
        <span className={cn(
          "text-[10px] font-bold leading-none",
          isPositive ? "text-emerald-500" : "text-red-500"
        )}>{change}</span>
      )}
    </div>
  </div>
);

const TradePanel = () => {
  return (
    <Card className="rounded-xl border-border bg-card shadow-sm h-full">
      <CardHeader className="p-3 pb-1">
        <CardTitle className="text-xs font-semibold">Trade</CardTitle>
      </CardHeader>
      <CardContent className="p-3 space-y-3">
        <Tabs defaultValue="buy" className="w-full">
          <TabsList className="w-full grid grid-cols-2 h-8">
            <TabsTrigger value="buy" className="text-[10px]">Buy</TabsTrigger>
            <TabsTrigger value="sell" className="text-[10px]">Sell</TabsTrigger>
          </TabsList>
          <TabsContent value="buy" className="space-y-3 pt-3">
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[9px] text-muted-foreground uppercase font-bold px-0.5">
                <Label>Pay</Label>
                <span>Bal: 12.42</span>
              </div>
              <div className="flex items-center gap-2 bg-muted/50 border border-input rounded-md px-2 py-1.5">
                <Input 
                  type="number" 
                  placeholder="0.0" 
                  className="bg-transparent border-none p-0 h-auto text-base font-bold focus-visible:ring-0 shadow-none"
                />
                <Select defaultValue="eth">
                  <SelectTrigger className="w-16 h-6 text-[9px] font-bold border-none bg-accent shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eth">ETH</SelectItem>
                    <SelectItem value="usdc">USDC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="flex justify-center -my-2 relative z-10">
              <Button variant="outline" size="icon" className="h-6 w-6 rounded-full bg-background border-border">
                <ArrowRight size={10} className="rotate-90" />
              </Button>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between items-center text-[9px] text-muted-foreground uppercase font-bold px-0.5">
                <Label>Receive</Label>
              </div>
              <div className="flex items-center gap-2 bg-muted/50 border border-input rounded-md px-2 py-1.5">
                <div className="flex-grow text-base font-bold text-muted-foreground">0.0</div>
                <Select defaultValue="spield">
                  <SelectTrigger className="w-16 h-6 text-[9px] font-bold border-none bg-primary text-primary-foreground shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="spield">SPIELD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex justify-between items-center text-[9px] font-bold uppercase text-muted-foreground">
                <Label>Leverage</Label>
                <span className="text-primary">2.5x</span>
              </div>
              <Slider defaultValue={[2.5]} max={10} step={0.1} />
            </div>

            <div className="rounded-md bg-muted/30 p-2 space-y-1 border border-border/50">
              <div className="flex justify-between text-[9px] font-medium">
                <span className="text-muted-foreground">Impact</span>
                <span className="text-emerald-500">0.05%</span>
              </div>
              <div className="flex justify-between text-[9px] font-medium">
                <span className="text-muted-foreground">Fee</span>
                <span className="text-foreground">$4.12</span>
              </div>
            </div>

            <Button className="w-full h-8 text-[10px] font-bold uppercase tracking-widest shadow-none">
              Swap
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

const DashboardPage = () => {
  return (
    <div className="h-screen bg-background text-foreground flex overflow-hidden dark">
      {/* Sidebar - Compact and Clean */}
      <aside className="w-16 border-r border-border bg-card flex flex-col items-center py-6 gap-6 shrink-0">
        <div className="mb-4">
          <img src={logo} alt="Logo" className="w-7 h-7 object-contain grayscale" />
        </div>

        <nav className="flex flex-col gap-4 flex-grow">
          <SidebarIcon icon={LayoutDashboard} active />
          <SidebarIcon icon={BarChart3} />
          <SidebarIcon icon={Wallet2} />
          <SidebarIcon icon={Plane} />
          <SidebarIcon icon={ShieldCheck} />
          <SidebarIcon icon={History} />
        </nav>

        <div className="flex flex-col gap-4 mt-auto">
          <SidebarIcon icon={Bell} />
          <SidebarIcon icon={Settings} />
          <div className="w-8 h-8 rounded-full border border-border bg-accent flex items-center justify-center overflow-hidden hover:border-primary transition-colors cursor-pointer">
            <div className="w-full h-full bg-gradient-to-br from-zinc-500 to-zinc-800" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-grow flex flex-col min-w-0">
        <header className="h-14 border-b border-border flex items-center justify-between px-6 bg-card/50 backdrop-blur-sm sticky top-0 z-20">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="text-muted-foreground">Dashboard</span>
            <span className="text-muted-foreground">/</span>
            <span>Portfolio</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative w-64 hidden sm:block">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input 
                placeholder="Search..." 
                className="h-8 pl-9 text-xs bg-muted/50 border-input shadow-none focus-visible:ring-1"
              />
            </div>
            <div className="h-4 w-px bg-border mx-1" />
            <Button variant="outline" size="sm" className="h-8 gap-2 px-3 text-xs font-bold border-input bg-card shadow-none hover:bg-accent transition-all">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              0x4F...3a92
              <ChevronDown size={12} className="text-muted-foreground" />
            </Button>
          </div>
        </header>

        <div className="flex-grow overflow-y-auto p-4 lg:p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              
              {/* Analytics */}
              <div className="lg:col-span-8 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card border border-border p-3 px-5 rounded-xl shadow-sm mb-2">
                  <div className="space-y-0.5">
                    <h1 className="text-xl font-display font-medium tracking-tight leading-none">Portfolio</h1>
                    <p className="text-muted-foreground text-[9px] tracking-wide uppercase font-bold">Protocol Metrics</p>
                  </div>
                  <div className="flex items-center">
                    <StatItem label="Balance" value="$124,502" change="+2.4%" />
                    <StatItem label="Yield" value="$12,482" change="+14.2%" />
                    <StatItem label="Active" value="12" />
                  </div>
                </div>

                <Card className="rounded-xl border-border bg-card shadow-sm overflow-hidden">
                  <CardHeader className="p-4 pb-0">
                    <div className="flex justify-between items-start">
                      <div className="space-y-0.5">
                        <CardTitle className="text-sm font-semibold">Portfolio Performance</CardTitle>
                        <CardDescription className="text-[10px]">TVL growth over the last 30 days</CardDescription>
                      </div>
                      <div className="flex items-center border border-border rounded-md p-0.5 bg-muted/50">
                        {['7D', '30D', 'ALL'].map((p, i) => (
                          <button key={p} className={cn(
                            "px-2 py-0.5 rounded-[3px] text-[9px] font-bold transition-all",
                            i === 1 ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                          )}>{p}</button>
                        ))}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-2">
                    <CustomChart />
                  </CardContent>
                </Card>

                {/* Recent Activity Mini Table */}
                <Card className="rounded-xl border-border bg-card shadow-sm overflow-hidden">
                   <div className="p-3 border-b border-border flex items-center justify-between">
                      <h3 className="text-xs font-semibold">Recent Transactions</h3>
                      <Button variant="link" size="sm" className="h-auto p-0 text-[9px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">View All</Button>
                   </div>
                   <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <tbody className="divide-y divide-border">
                          {[
                            { id: '0x81...9f21', type: 'Stake SPIELD', amount: '+42,000 SPIELD', status: 'Done', time: '2m ago' },
                            { id: '0xa4...1d42', type: 'Swap ASSET', amount: '-1,240 USDT', status: 'Done', time: '1h ago' },
                          ].map((row, i) => (
                            <tr key={i} className="hover:bg-muted/50 transition-colors">
                              <td className="px-4 py-2 text-[9px] font-mono text-muted-foreground">{row.id}</td>
                              <td className="px-4 py-2 text-[10px] font-semibold">{row.type}</td>
                              <td className="px-4 py-2 text-[10px] font-bold text-foreground">{row.amount}</td>
                              <td className="px-4 py-2 text-[9px] uppercase font-bold text-emerald-500">{row.status}</td>
                              <td className="px-4 py-2 text-[10px] text-right text-muted-foreground">{row.time}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                   </div>
                </Card>
              </div>

              {/* Sidebar Panel */}
              <div className="lg:col-span-4 h-full">
                <TradePanel />
              </div>

            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DashboardPage;

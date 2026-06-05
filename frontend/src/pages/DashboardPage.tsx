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
  TrendingUp,
  ArrowRight,
  Zap,
  Info,
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
    color: "#00ffcc",
  },
};

const CustomChart = () => (
  <ChartContainer config={chartConfig} className="h-full w-full">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorTvl" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#00ffcc" stopOpacity={0.15}/>
            <stop offset="95%" stopColor="#00ffcc" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3" />
        <XAxis 
          dataKey="day" 
          axisLine={false} 
          tickLine={false} 
          tick={{ fill: 'rgba(255,255,255,0.2)', fontSize: 10, fontWeight: 'bold' }}
          dy={10}
        />
        <YAxis hide />
        <Tooltip 
          content={<ChartTooltipContent indicator="dot" />}
          cursor={{ stroke: 'rgba(255,255,255,0.05)', strokeWidth: 1 }}
        />
        <Area 
          type="monotone" 
          dataKey="tvl" 
          stroke="#00ffcc" 
          strokeWidth={2.5}
          fillOpacity={1} 
          fill="url(#colorTvl)" 
          animationDuration={2000}
        />
      </AreaChart>
    </ResponsiveContainer>
  </ChartContainer>
);

const SidebarIcon = ({ icon: Icon, active = false }: { icon: LucideIcon, active?: boolean }) => (
  <button className={cn(
    "w-12 h-12 flex items-center justify-center rounded-2xl transition-all duration-300 group relative",
    active ? "bg-brand-primary/10 text-brand-primary shadow-[0_0_20px_rgba(0,255,204,0.1)]" : "text-white/30 hover:text-white hover:bg-white/5"
  )}>
    <Icon size={22} strokeWidth={active ? 2.5 : 2} />
    {active && (
      <motion.div 
        layoutId="sidebar-dot"
        className="absolute -left-1 w-1 h-6 bg-brand-primary rounded-r-full shadow-[0_0_10px_#00ffcc]"
      />
    )}
    
    {/* Tooltip-like effect could be added here if needed */}
  </button>
);

const TradePanel = () => {
  return (
    <Card className="bg-white/[0.02] border-white/5 backdrop-blur-xl rounded-3xl overflow-hidden h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl font-display font-medium">Trade Panel</CardTitle>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/40 hover:text-white"><Settings size={16} /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-white/40 hover:text-white"><Info size={16} /></Button>
          </div>
        </div>
        <CardDescription className="text-white/40 text-[10px] uppercase tracking-widest font-bold">Execute on-chain swaps</CardDescription>
      </CardHeader>
      <CardContent className="flex-grow space-y-6 pt-4">
        <Tabs defaultValue="buy" className="w-full">
          <TabsList className="w-full bg-white/5 p-1 rounded-xl flex mb-6">
            <TabsTrigger value="buy" className="flex-grow py-2 rounded-lg text-xs font-bold transition-all data-[state=active]:bg-brand-primary data-[state=active]:text-black text-white/40">BUY</TabsTrigger>
            <TabsTrigger value="sell" className="flex-grow py-2 rounded-lg text-xs font-bold transition-all data-[state=active]:bg-red-500 data-[state=active]:text-white text-white/40">SELL</TabsTrigger>
          </TabsList>

          <TabsContent value="buy" className="space-y-6 mt-0">
            {/* Pay Section */}
            <div className="space-y-3">
              <div className="flex justify-between items-center px-1">
                <Label className="text-[10px] uppercase tracking-wider font-bold text-white/30">You Pay</Label>
                <span className="text-[10px] font-bold text-white/20">Balance: 12.42 ETH</span>
              </div>
              <div className="relative group">
                <div className="absolute inset-0 bg-white/5 rounded-2xl group-focus-within:bg-white/[0.08] transition-colors" />
                <div className="relative flex items-center p-3 gap-3">
                  <Input 
                    type="number" 
                    placeholder="0.0" 
                    className="bg-transparent border-none text-2xl font-black text-white focus-visible:ring-0 placeholder:text-white/10 p-0 h-auto"
                  />
                  <Select defaultValue="eth">
                    <SelectTrigger className="w-28 bg-white/10 border-white/10 rounded-xl h-10 font-bold text-xs hover:bg-white/20 transition-all">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0a161e] border-white/10 text-white">
                      <SelectItem value="eth">ETH</SelectItem>
                      <SelectItem value="usdc">USDC</SelectItem>
                      <SelectItem value="wbtc">WBTC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Transition Icon */}
            <div className="flex justify-center -my-4 relative z-10">
              <div className="bg-[#020609] p-2 rounded-full border border-white/5 shadow-xl">
                <div className="bg-white/5 p-2 rounded-full text-brand-primary">
                  <ArrowRight size={16} className="rotate-90" />
                </div>
              </div>
            </div>

            {/* Receive Section */}
            <div className="space-y-3 pt-2">
              <div className="flex justify-between items-center px-1">
                <Label className="text-[10px] uppercase tracking-wider font-bold text-white/30">You Receive</Label>
                <span className="text-[10px] font-bold text-white/20">Est. Amount</span>
              </div>
              <div className="relative group">
                <div className="absolute inset-0 bg-white/5 rounded-2xl transition-colors" />
                <div className="relative flex items-center p-3 gap-3">
                  <div className="flex-grow text-2xl font-black text-white/40">0.0</div>
                  <Select defaultValue="spield">
                    <SelectTrigger className="w-28 bg-brand-primary/10 border-brand-primary/20 text-brand-primary rounded-xl h-10 font-bold text-xs hover:bg-brand-primary/20 transition-all">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#0a161e] border-white/10 text-white">
                      <SelectItem value="spield">SPIELD</SelectItem>
                      <SelectItem value="dao">DAO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Leverage Slider */}
            <div className="space-y-4 pt-2">
              <div className="flex justify-between items-center px-1">
                <Label className="text-[10px] uppercase tracking-wider font-bold text-white/30">Leverage</Label>
                <span className="text-[10px] font-bold text-brand-primary">2.5x</span>
              </div>
              <Slider defaultValue={[2.5]} max={10} step={0.1} className="py-2" />
            </div>

            {/* Trade Info */}
            <div className="bg-white/[0.03] rounded-2xl p-4 space-y-3">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-tight">
                <span className="text-white/20">Price Impact</span>
                <span className="text-green-400">0.05%</span>
              </div>
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-tight">
                <span className="text-white/20">Est. Network Fee</span>
                <span className="text-white/60">$4.12</span>
              </div>
            </div>

            <Button className="w-full h-14 rounded-2xl bg-brand-primary text-black font-black text-xs tracking-[0.2em] shadow-[0_0_30px_rgba(0,255,204,0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all flex gap-2">
              <Zap size={18} fill="currentColor" />
              EXECUTE TRADE
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

const DashboardPage = () => {
  return (
    <div className="h-screen bg-[#020609] text-white flex overflow-hidden font-body relative">
      {/* Background Ambience */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-brand-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-brand-primary/5 rounded-full blur-[120px]" />
      </div>

      {/* Slim Sidebar - Inspired by Screenshot */}
      <aside className="w-20 lg:w-24 flex flex-col items-center border-r border-white/5 py-8 gap-8 relative z-20 bg-white/[0.01] backdrop-blur-xl">
        <div className="mb-4">
          <img src={logo} alt="Logo" className="w-10 h-10 object-contain drop-shadow-[0_0_10px_#00ffcc40]" />
        </div>

        <nav className="flex flex-col gap-4">
          <SidebarIcon icon={LayoutDashboard} active />
          <SidebarIcon icon={BarChart3} />
          <SidebarIcon icon={Wallet2} />
          <SidebarIcon icon={Plane} />
          <SidebarIcon icon={ShieldCheck} />
          <SidebarIcon icon={History} />
        </nav>

        <div className="mt-auto flex flex-col gap-4">
          <SidebarIcon icon={Bell} />
          <SidebarIcon icon={Settings} />
          <div className="w-10 h-10 rounded-full border-2 border-brand-primary/20 p-0.5 overflow-hidden group cursor-pointer hover:border-brand-primary transition-colors">
            <div className="w-full h-full rounded-full bg-gradient-to-br from-brand-primary to-blue-500" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-grow flex flex-col relative z-10">
        {/* Top Header */}
        <header className="h-20 flex items-center justify-between px-10">
          <div className="relative w-80">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" />
            <input 
              type="text" 
              placeholder="Quick search..." 
              className="w-full bg-white/5 border border-white/5 rounded-2xl py-2.5 pl-12 pr-4 text-xs font-medium focus:outline-none focus:bg-white/[0.08] transition-all"
            />
          </div>

          <div className="flex items-center gap-6">
            <div className="flex flex-col items-end">
              <span className="text-[10px] uppercase tracking-widest font-black text-brand-primary leading-none mb-1">Mainnet</span>
              <span className="text-xs font-bold text-white/60">Connected</span>
            </div>
            <button className="flex items-center gap-3 px-5 py-2.5 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/[0.08] transition-all group">
              <div className="w-1.5 h-1.5 rounded-full bg-brand-primary shadow-[0_0_10px_#00ffcc]" />
              <span className="text-xs font-black tracking-widest text-white/80">0x4F...3a92</span>
              <ChevronDown size={14} className="text-white/20 group-hover:text-white/60 transition-all" />
            </button>
          </div>
        </header>

        {/* Scrollable Dashboard Content */}
        <div className="flex-grow overflow-y-auto px-10 pb-10">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
            
            {/* Left Column: Analytics & Overview */}
            <div className="xl:col-span-8 space-y-8">
              <header className="py-4">
                <h1 className="text-5xl font-display font-medium tracking-tight mb-2">Portfolio</h1>
                <p className="text-white/40 text-sm tracking-wide font-light">Aggregated data from your connected sub-DAOs.</p>
              </header>

              {/* Metric Row */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {[
                  { label: 'Total Balance', val: '$124,502', change: '+2.4%' },
                  { label: 'Yield Earned', val: '$12,482', change: '+14.2%' },
                  { label: 'Active Stakes', val: '12', change: 'Stable' }
                ].map((m) => (
                  <div key={m.label} className="bg-white/[0.03] border border-white/5 p-6 rounded-3xl group hover:bg-white/[0.05] transition-all">
                    <p className="text-[10px] uppercase tracking-widest font-black text-white/20 mb-3 group-hover:text-brand-primary transition-colors">{m.label}</p>
                    <div className="flex items-end justify-between">
                      <h2 className="text-3xl font-black tracking-tight">{m.val}</h2>
                      <span className="text-xs font-bold text-green-400 mb-1">{m.change}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Large Chart Area */}
              <div className="bg-white/[0.02] border border-white/5 rounded-[40px] p-8 min-h-[400px] flex flex-col relative overflow-hidden">
                <div className="flex justify-between items-center relative z-10 mb-10">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                      <TrendingUp size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold font-display">Performance</h3>
                      <p className="text-[10px] uppercase tracking-widest font-bold text-white/30">Growth over time</p>
                    </div>
                  </div>
                </div>

                <div className="flex-grow relative z-10">
                  <CustomChart />
                </div>
                
                <div className="absolute top-1/2 left-0 w-full h-px bg-white/5" />
                <div className="absolute top-1/4 left-0 w-full h-px bg-white/[0.02]" />
                <div className="absolute top-3/4 left-0 w-full h-px bg-white/[0.02]" />
              </div>
            </div>

            {/* Right Column: Trade Panel */}
            <div className="xl:col-span-4 h-full pt-4 sticky top-0">
              <TradePanel />
            </div>

          </div>
        </div>
      </main>
    </div>
  );
};

export default DashboardPage;

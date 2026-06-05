import { ArrowDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TradePanel = () => {
  return (
    <Card className="h-full rounded-xl border-border bg-card shadow-sm">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-base font-semibold">Trade</CardTitle>
        <CardDescription className="text-xs">Swap into SPIELD with leverage</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <Tabs defaultValue="buy" className="w-full">
          <TabsList className="grid h-9 w-full grid-cols-2">
            <TabsTrigger value="buy" className="text-xs font-semibold">
              Buy
            </TabsTrigger>
            <TabsTrigger value="sell" className="text-xs font-semibold">
              Sell
            </TabsTrigger>
          </TabsList>
          <TabsContent value="buy" className="space-y-4 pt-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-0.5 text-xs font-semibold uppercase text-muted-foreground">
                <Label>Pay</Label>
                <span className="normal-case">Bal: 12.42</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/50 px-3 py-2.5">
                <Input
                  type="number"
                  placeholder="0.0"
                  className="h-auto border-none bg-transparent p-0 text-lg font-bold shadow-none focus-visible:ring-0"
                />
                <Select defaultValue="eth">
                  <SelectTrigger className="h-7 w-20 border-none bg-accent text-xs font-bold shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eth">ETH</SelectItem>
                    <SelectItem value="usdc">USDC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="relative z-10 -my-3 flex justify-center">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 rounded-full border-border bg-background"
              >
                <ArrowDown size={12} />
              </Button>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between px-0.5 text-xs font-semibold uppercase text-muted-foreground">
                <Label>Receive</Label>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-input bg-muted/50 px-3 py-2.5">
                <div className="grow text-lg font-bold text-muted-foreground">0.0</div>
                <Select defaultValue="spield">
                  <SelectTrigger className="h-7 w-20 border-none bg-primary text-xs font-bold text-primary-foreground shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="spield">SPIELD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2.5 pt-1">
              <div className="flex items-center justify-between text-xs font-semibold uppercase text-muted-foreground">
                <Label>Leverage</Label>
                <span className="text-foreground">2.5x</span>
              </div>
              <Slider defaultValue={[2.5]} max={10} step={0.1} />
            </div>

            <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/30 p-3">
              <div className="flex justify-between text-xs font-medium">
                <span className="text-muted-foreground">Price Impact</span>
                <span className="text-emerald-500">0.05%</span>
              </div>
              <div className="flex justify-between text-xs font-medium">
                <span className="text-muted-foreground">Network Fee</span>
                <span className="text-foreground">$4.12</span>
              </div>
            </div>

            <Button className="h-10 w-full text-sm font-bold uppercase tracking-wide shadow-none">
              Swap
            </Button>
          </TabsContent>

          <TabsContent value="sell" className="pt-4">
            <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              No open positions to sell.
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default TradePanel;

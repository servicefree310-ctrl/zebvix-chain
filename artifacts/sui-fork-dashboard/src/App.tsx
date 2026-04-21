import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Shell } from "@/components/layout/shell";

// Pages
import Home from "@/pages/home";
import Setup from "@/pages/setup";
import Genesis from "@/pages/genesis";
import Validators from "@/pages/validators";
import Network from "@/pages/network";
import Tokenomics from "@/pages/tokenomics";
import Customization from "@/pages/customization";
import Checklist from "@/pages/checklist";
import Production from "@/pages/production";
import QuickStart from "@/pages/quick-start";
import BlockExplorer from "@/pages/block-explorer";
import WalletPage from "@/pages/wallet";
import Faucet from "@/pages/faucet";
import Bridge from "@/pages/bridge";
import Staking from "@/pages/staking";
import Dex from "@/pages/dex";
import ZbxTokenomics from "@/pages/zbx-tokenomics";
import Implementation from "@/pages/implementation";
import Rebranding from "@/pages/rebranding";
import PhaseTracker from "@/pages/phase-tracker";

const queryClient = new QueryClient();

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/quick-start" component={QuickStart} />
        <Route path="/setup" component={Setup} />
        <Route path="/genesis" component={Genesis} />
        <Route path="/validators" component={Validators} />
        <Route path="/network" component={Network} />
        <Route path="/tokenomics" component={Tokenomics} />
        <Route path="/customization" component={Customization} />
        <Route path="/checklist" component={Checklist} />
        <Route path="/production" component={Production} />
        <Route path="/block-explorer" component={BlockExplorer} />
        <Route path="/wallet" component={WalletPage} />
        <Route path="/faucet" component={Faucet} />
        <Route path="/bridge" component={Bridge} />
        <Route path="/staking" component={Staking} />
        <Route path="/dex" component={Dex} />
        <Route path="/zbx-tokenomics" component={ZbxTokenomics} />
        <Route path="/implementation" component={Implementation} />
        <Route path="/rebranding" component={Rebranding} />
        <Route path="/phase-tracker" component={PhaseTracker} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

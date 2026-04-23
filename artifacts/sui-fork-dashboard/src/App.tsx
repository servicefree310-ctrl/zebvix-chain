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
import EconomicDesign from "@/pages/economic-design";
import FabricLayer from "@/pages/fabric-layer";
import CodeReview from "@/pages/code-review";
import Downloads from "@/pages/downloads";
import ChainCode from "@/pages/chain-code";
import ChainStatus from "@/pages/chain-status";
import ConsensusRoadmap from "@/pages/consensus-roadmap";
import LiveChain from "@/pages/live-chain";
import BalanceLookup from "@/pages/balance-lookup";
import MultisigExplorer from "@/pages/multisig-explorer";
import PayIdResolver from "@/pages/payid-resolver";
import ConnectWallet from "@/pages/connect-wallet";

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
        <Route path="/economic-design" component={EconomicDesign} />
        <Route path="/fabric-layer" component={FabricLayer} />
        <Route path="/code-review" component={CodeReview} />
        <Route path="/downloads" component={Downloads} />
        <Route path="/chain-code" component={ChainCode} />
        <Route path="/chain-status" component={ChainStatus} />
        <Route path="/consensus-roadmap" component={ConsensusRoadmap} />
        <Route path="/live-chain" component={LiveChain} />
        <Route path="/balance-lookup" component={BalanceLookup} />
        <Route path="/multisig-explorer" component={MultisigExplorer} />
        <Route path="/payid-resolver" component={PayIdResolver} />
        <Route path="/connect-wallet" component={ConnectWallet} />
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

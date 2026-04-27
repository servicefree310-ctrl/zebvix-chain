import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Shell } from "@/components/layout/shell";
import { WalletProvider } from "@/contexts/wallet-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";

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
import BridgeLive from "@/pages/bridge-live";
import Staking from "@/pages/staking";
import TokenCreate from "@/pages/token-create";
import TokenTrade from "@/pages/token-trade";
import TokenLiquidity from "@/pages/token-liquidity";
import TokenMetadata from "@/pages/token-metadata";
import Dex from "@/pages/dex";
import ZbxTokenomics from "@/pages/zbx-tokenomics";
import Implementation from "@/pages/implementation";
import Rebranding from "@/pages/rebranding";
import PhaseTracker from "@/pages/phase-tracker";
import EconomicDesign from "@/pages/economic-design";
import FabricLayer from "@/pages/fabric-layer";
import CodeReview from "@/pages/code-review";
import Downloads from "@/pages/downloads";
import SdkPage from "@/pages/sdk";
import ChainBuilder from "@/pages/chain-builder";
import ChainCode from "@/pages/chain-code";
import ServiceCode from "@/pages/service-code";
import AdminPage from "@/pages/admin";
import ChainStatus from "@/pages/chain-status";
import ConsensusRoadmap from "@/pages/consensus-roadmap";
import LiveChain from "@/pages/live-chain";
import BalanceLookup from "@/pages/balance-lookup";
import MultisigExplorer from "@/pages/multisig-explorer";
import PayIdResolver from "@/pages/payid-resolver";
import ConnectWallet from "@/pages/connect-wallet";
import SwapPage from "@/pages/swap";
import ZvmExplorer from "@/pages/zvm-explorer";
import PoolExplorer from "@/pages/pool-explorer";
import GovernancePage from "@/pages/governance";
import SmartContracts from "@/pages/smart-contracts";
import RpcPlayground from "@/pages/rpc-playground";
import PayIdRegister from "@/pages/payid-register";
import ImportWallet from "@/pages/import-wallet";
import DocsPage from "@/pages/docs";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live chain data is fast-moving but most of the dashboard's panels
      // tolerate ~30s freshness. Aggressive refetch-on-focus was causing
      // duplicate RPC calls every time the user switched tabs.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
      retryDelay: 800,
    },
    mutations: {
      retry: 0,
    },
  },
});

function RouteBoundary({ children }: { children: React.ReactNode }) {
  // Re-mount the ErrorBoundary whenever the path changes so a recovered route
  // doesn't keep showing the previous page's fallback after navigation.
  const [location] = useLocation();
  return <ErrorBoundary key={location}>{children}</ErrorBoundary>;
}

function Router() {
  return (
    <Shell>
      <RouteBoundary>
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
        <Route path="/bridge-live" component={BridgeLive} />
        <Route path="/staking" component={Staking} />
        <Route path="/token-create" component={TokenCreate} />
        <Route path="/token-trade" component={TokenTrade} />
        <Route path="/token-liquidity" component={TokenLiquidity} />
        <Route path="/token-metadata" component={TokenMetadata} />
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
        <Route path="/service-code" component={ServiceCode} />
        <Route path="/admin" component={AdminPage} />
        <Route path="/chain-status" component={ChainStatus} />
        <Route path="/consensus-roadmap" component={ConsensusRoadmap} />
        <Route path="/live-chain" component={LiveChain} />
        <Route path="/balance-lookup" component={BalanceLookup} />
        <Route path="/multisig-explorer" component={MultisigExplorer} />
        <Route path="/payid-resolver" component={PayIdResolver} />
        <Route path="/payid-register" component={PayIdRegister} />
        <Route path="/import-wallet" component={ImportWallet} />
        <Route path="/connect-wallet" component={ConnectWallet} />
        <Route path="/swap" component={SwapPage} />
        <Route path="/zvm-explorer" component={ZvmExplorer} />
        <Route path="/evm-explorer" component={ZvmExplorer} />
        <Route path="/pool-explorer" component={PoolExplorer} />
        <Route path="/governance" component={GovernancePage} />
        <Route path="/smart-contracts" component={SmartContracts} />
        <Route path="/rpc-playground" component={RpcPlayground} />
        <Route path="/docs" component={DocsPage} />
        <Route path="/sdk" component={SdkPage} />
        <Route path="/chain-builder" component={ChainBuilder} />
        <Route component={NotFound} />
      </Switch>
      </RouteBoundary>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WalletProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </WalletProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

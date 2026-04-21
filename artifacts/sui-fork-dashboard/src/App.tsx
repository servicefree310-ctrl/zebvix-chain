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

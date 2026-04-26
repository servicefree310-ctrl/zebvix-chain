import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { shadcn } from "@clerk/themes";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster as RadixToaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect, useRef } from "react";

import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Editor from "./pages/Editor";
import NewSite from "./pages/NewSite";
import Templates from "./pages/Templates";
import Leads from "./pages/Leads";
import Payments from "./pages/Payments";
import Analytics from "./pages/Analytics";
import PublicSite from "./pages/PublicSite";
import NotFound from "./pages/not-found";

const queryClient = new QueryClient();
const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in .env file");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(191, 100%, 50%)",
    colorForeground: "hsl(0, 0%, 98%)",
    colorMutedForeground: "hsl(240, 5%, 64.9%)",
    colorDanger: "hsl(0, 62.8%, 30.6%)",
    colorBackground: "hsl(240, 10%, 3.9%)",
    colorInput: "hsl(240, 3.7%, 15.9%)",
    colorInputForeground: "hsl(0, 0%, 98%)",
    colorNeutral: "hsl(240, 3.7%, 15.9%)",
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "bg-[#0a0a0a] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#27272a]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-white",
    headerSubtitle: "text-gray-400",
    socialButtonsBlockButtonText: "text-white",
    formFieldLabel: "text-white",
    footerActionLink: "text-[#00F0FF]",
    footerActionText: "text-gray-400",
    dividerText: "text-gray-400",
    identityPreviewEditButton: "text-[#00F0FF]",
    formFieldSuccessText: "text-green-400",
    alertText: "text-red-400",
    logoBox: "",
    logoImage: "",
    socialButtonsBlockButton: "border-[#27272a] hover:bg-[#27272a]",
    formButtonPrimary: "bg-[#00F0FF] hover:bg-[#00F0FF]/90 text-black",
    formFieldInput: "bg-[#18181b] border-[#27272a] text-white",
    footerAction: "",
    dividerLine: "bg-[#27272a]",
    alert: "border-red-900 bg-red-950/50",
    otpCodeFieldInput: "bg-[#18181b] border-[#27272a] text-white",
    formFieldRow: "",
    main: "",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: any }) {
  return (
    <>
      <Show when="signed-in">
        <Component />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function Router() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignUpPage} />
          <Route path="/p/:subdomain" component={PublicSite} />
          <Route path="/p/:subdomain/:page" component={PublicSite} />
          <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
          <Route path="/sites/new"><ProtectedRoute component={NewSite} /></Route>
          <Route path="/templates"><ProtectedRoute component={Templates} /></Route>
          <Route path="/editor/:id"><ProtectedRoute component={Editor} /></Route>
          <Route path="/sites/:id/leads"><ProtectedRoute component={Leads} /></Route>
          <Route path="/sites/:id/payments"><ProtectedRoute component={Payments} /></Route>
          <Route path="/sites/:id/analytics"><ProtectedRoute component={Analytics} /></Route>
          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <TooltipProvider>
      <WouterRouter base={basePath}>
        <Router />
      </WouterRouter>
      <RadixToaster />
      <SonnerToaster theme="dark" richColors closeButton position="top-right" />
    </TooltipProvider>
  );
}

export default App;
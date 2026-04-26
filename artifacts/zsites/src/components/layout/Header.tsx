import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hexagon, LogOut, LayoutDashboard, CreditCard, Users, BarChart3, Settings } from "lucide-react";

export function Header() {
  const { user, isLoaded } = useUser();
  const { signOut } = useClerk();
  const [location] = useLocation();
  const isPublic = location === "/" || location.startsWith("/p/");

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-black/50 backdrop-blur-xl">
      <div className="container flex h-16 items-center justify-between px-4 md:px-6 mx-auto">
        <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
          <Hexagon className="h-6 w-6 text-[#00F0FF]" />
          <span className="text-lg font-bold tracking-tight text-white hidden sm:inline-block">
            Zebvix<span className="text-[#00F0FF]">Sites</span>
          </span>
        </Link>

        <div className="flex items-center gap-4">
          {!isLoaded ? null : user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                  <Avatar className="h-9 w-9 border border-white/10">
                    <AvatarImage src={user.imageUrl} alt={user.fullName || "User"} />
                    <AvatarFallback className="bg-zinc-900 text-white">
                      {user.firstName?.charAt(0)}{user.lastName?.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 border-white/10 bg-black/95 backdrop-blur-xl text-white" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.fullName}</p>
                    <p className="text-xs leading-none text-zinc-400">
                      {user.primaryEmailAddress?.emailAddress}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem asChild className="focus:bg-white/10 focus:text-white cursor-pointer">
                  <Link href="/dashboard" className="flex items-center w-full">
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    <span>Dashboard</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem
                  className="text-red-400 focus:bg-red-500/10 focus:text-red-400 cursor-pointer"
                  onClick={() => signOut()}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" className="text-zinc-300 hover:text-white hover:bg-white/10 hidden sm:inline-flex">
                <Link href="/sign-in">Sign In</Link>
              </Button>
              <Button asChild className="bg-[#00F0FF] text-black hover:bg-[#00F0FF]/90 font-medium">
                <Link href="/sign-up">Start Building</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

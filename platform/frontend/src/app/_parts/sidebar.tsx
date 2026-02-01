"use client";
import { SignedIn, SignedOut, UserButton } from "@daveyplate/better-auth-ui";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@radix-ui/react-collapsible";
import { E2eTestId } from "@shared";
import { requiredPagePermissionsMap } from "@shared/access-control";
import {
  BookOpen,
  Bot,
  Bug,
  Cable,
  Calendar,
  Calendar1,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  DollarSign,
  Folder,
  Github,
  Grip,
  History,
  HomeIcon,
  Info,
  LogIn,
  Logs,
  type LucideIcon,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  Network,
  Plus,
  Router,
  Search,
  Settings,
  Shield,
  Slack,
  Star,
  Wrench,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChatSidebarSection } from "@/app/_parts/chat-sidebar-section";
import { DefaultCredentialsWarning } from "@/components/default-credentials-warning";
import Divider from "@/components/divider";
import { WithPermissions } from "@/components/roles/with-permissions";
import { SecurityEngineWarning } from "@/components/security-engine-warning";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useIsAuthenticated } from "@/lib/auth.hook";
import { usePermissionMap } from "@/lib/auth.query";
import config from "@/lib/config";
import { useGithubStars } from "@/lib/github.query";
import { useOrgTheme } from "@/lib/theme.hook";
import Home from "../page";

interface MenuItem {
  title: string;
  url: string;
  icon: LucideIcon;
  customIsActive?: (pathname: string, searchParams: URLSearchParams) => boolean;
}

const getNavigationItems = (isAuthenticated: boolean): MenuItem[] => {
  if (!isAuthenticated) {
    return [];
  }
  return [
    {
      title: "New Chat",
      url: "/chat",
      icon: MessageCircle,
      customIsActive: (pathname: string, searchParams: URLSearchParams) =>
        pathname === "/chat" && !searchParams.get("conversation"),
    },
    {
      title: "Agents",
      url: "/agents",
      icon: Bot,
    },
    {
      title: "MCP Gateways",
      url: "/mcp-gateways",
      icon: Shield,
    },
    {
      title: "LLM Proxies",
      url: "/llm-proxies",
      icon: Network,
    },
    {
      title: "Logs",
      url: "/logs/llm-proxy",
      icon: MessagesSquare,
      customIsActive: (pathname: string) => pathname.startsWith("/logs"),
    },
    {
      title: "Tool Policies",
      url: "/tools",
      icon: Wrench,
      customIsActive: (pathname: string) => pathname.startsWith("/tools"),
    },
    {
      title: "MCP Registry",
      url: "/mcp-catalog/registry",
      icon: Router,
      customIsActive: (pathname: string) => pathname.startsWith("/mcp-catalog"),
    },
    {
      title: "Cost & Limits",
      url: "/cost",
      icon: DollarSign,
    },
    {
      title: "Connect",
      url: "/connection",
      icon: Cable,
    },
    {
      title: "Settings",
      url: "/settings",
      icon: Settings,
      customIsActive: (pathname: string) => pathname.startsWith("/settings"),
    },
  ];
};

const userItems: MenuItem[] = [
  {
    title: "Sign in",
    url: "/auth/sign-in",
    icon: LogIn,
  },
  // Sign up is disabled - users must use invitation links to join
];

const CommunitySideBarSection = ({ starCount }: { starCount: number }) => (
  <SidebarGroup className="px-4 py-0">
    <SidebarGroupLabel>Community</SidebarGroupLabel>
    <SidebarGroupContent>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <a
              href="https://github.com/archestra-ai/archestra"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github />
              <span className="flex items-center gap-2">
                Star us on GitHub
                <span className="flex items-center gap-1 text-xs">
                  <Star className="h-3 w-3" />
                  {starCount}
                </span>
              </span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <a
              href="https://archestra.ai/docs/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <BookOpen />
              <span>Documentation</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <a
              href="https://join.slack.com/t/archestracommunity/shared_invite/zt-39yk4skox-zBF1NoJ9u4t59OU8XxQChg"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Slack />
              <span>Talk to developers</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <a
              href="https://github.com/archestra-ai/archestra/issues/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Bug />
              <span>Report a bug</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroupContent>
  </SidebarGroup>
);

const MainSideBarSection = ({
  isAuthenticated,
  pathname,
  searchParams,
  starCount,
}: {
  isAuthenticated: boolean;
  pathname: string;
  searchParams: URLSearchParams;
  starCount: number;
}) => {
  const allItems = getNavigationItems(isAuthenticated);
  const permissionMap = usePermissionMap(requiredPagePermissionsMap);
  const permittedItems = allItems.filter(
    (item) => permissionMap?.[item.url] ?? true,
  );

  const option1 = (
    <SidebarContent className="gap-1">
      <Divider className="w-[calc(100%-30px)] mx-auto" />
      <SidebarGroup>
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <Link href="/chat">
              <span>Chats</span>
              <MessagesSquare />
            </Link>
          </SidebarMenuButton>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive>
              <a href="#">
                <span>New Chat</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              My Chats
              <ChevronUp className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      <Divider className="w-[calc(100%-30px)] mx-auto" />
      <SidebarGroup>
        <SidebarMenuButton asChild>
          <Link href="/agents">
            <span>Agents</span>
            <Bot />
          </Link>
        </SidebarMenuButton>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={false}
            className="text-muted-foreground"
          >
            <span>About & Connect</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>My Agents</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>Agent Builder</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      <Divider className="w-[calc(100%-30px)] mx-auto" />
      <SidebarGroup>
        <SidebarMenuButton asChild>
          <Link href="/agents">
            <span>LLM Proxies</span>
            <Network />
          </Link>
        </SidebarMenuButton>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={false}
            className="text-muted-foreground"
          >
            <span>About & Connect</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>My Proxies</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>Cost & Limits</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>Logs</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      <Divider className="w-[calc(100%-30px)] mx-auto" />
      <SidebarGroup>
        <SidebarMenuButton asChild>
          <Link href="/agents">
            <span>MCP & Tools</span>
            <Wrench />
          </Link>
        </SidebarMenuButton>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={false}
            className="text-muted-foreground"
          >
            <span>About & Connect</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={false}
            className="text-muted-foreground"
          >
            <span>My MCP Gateways</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>MCP Registry</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>Tool Policies</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      <Divider className="w-[calc(100%-30px)] mx-auto" />
      <SidebarGroup>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <Settings />
              <span className="ml-1">Settings</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
    </SidebarContent>
  );

  const option2 = (
    <SidebarContent className="gap-1">
      <Divider className="w-[calc(100%-30px)] mx-auto" />
      <SidebarGroup>
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <Link href="/chat">
              <span>Chats</span>
              <MessagesSquare />
            </Link>
          </SidebarMenuButton>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive>
              <a href="#">
                <span>New Chat</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              My Chats
              <ChevronUp className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      <Divider className="w-[calc(100%-30px)] mx-auto" />
      <SidebarGroup>
        <SidebarMenuButton asChild>
          <Link href="/agents">
            <span>Agents</span>
            <Bot />
          </Link>
        </SidebarMenuButton>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>My Agents</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>Agent Builder</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      <Divider className="w-[calc(100%-30px)] mx-auto" />
      <SidebarGroup>
        <SidebarMenuButton asChild>
          <Link href="/agents">
            <span>LLM Proxies</span>
            <Network />
          </Link>
        </SidebarMenuButton>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>My Proxies</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>Cost & Limits</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>Logs</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      <Divider className="w-[calc(100%-30px)] mx-auto" />
      <SidebarGroup>
        <SidebarMenuButton asChild>
          <Link href="/agents">
            <span>MCP & Tools</span>
            <Wrench />
          </Link>
        </SidebarMenuButton>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={false}
            className="text-muted-foreground"
          >
            <span>My MCP Gateways</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>MCP Registry</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <span>Tool Policies</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      <Divider className="w-[calc(100%-30px)] mx-auto" />
      <SidebarGroup>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <Cable />
              <span className="ml-1">Connect</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-muted-foreground">
            <Link href="/chat">
              <Settings />
              <span className="ml-1">Settings</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
    </SidebarContent>
  );

  const menuBtnClassName = "opacity-99";
  const sidebarGroupClassName = "pb-0 pt-0";
  const groupLabelClassName = "height-[28px]";
  const dividerClassName =
    "w-[calc(100%-10px)] mx-auto mt-[-8px] mb-[4px] opacity-60";
  const option3 = (
    <SidebarContent className="gap-1">
      {/* <Divider className="w-[calc(100%-30px)] mx-auto" /> */}
      <SidebarGroup className={sidebarGroupClassName}>
        <SidebarGroupLabel className={groupLabelClassName}>
          Chats
        </SidebarGroupLabel>
        <Divider className={dividerClassName} />
        <SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive>
              <a href="#">
                <MessageSquareText />
                <span>New Chat</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className={menuBtnClassName}>
            <Link href="/chat">
              <MessagesSquare />
              My Chats (14)
              <Search className="ml-auto" />
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem className="pl-6 mt-[-6px]">
          <SidebarMenuButton asChild className="h-6 text-xs">
            <Link href="/chat">Sarcastic Greeting...</Link>
          </SidebarMenuButton>
          <SidebarMenuButton asChild className="h-6 text-xs">
            <Link href="/chat">Best Car in the World...</Link>
          </SidebarMenuButton>
          <SidebarMenuButton asChild className="h-6 text-xs">
            <Link href="/chat">Finance Help... </Link>
          </SidebarMenuButton>
          <SidebarMenuButton asChild className="h-6 text-xs">
            <Link href="/chat" className="opacity-70">
              <ChevronRight className="h-1 w-1 [&>svg]:size-1 [&>svg]:shrink-0" />
              <span className="text-xs">show more</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      {/* <Divider className="w-[calc(100%-30px)] mx-auto" /> */}
      <SidebarGroup className={sidebarGroupClassName}>
        <SidebarGroupLabel className={groupLabelClassName}>
          Agents
        </SidebarGroupLabel>
        <Divider className={dividerClassName} />
        <SidebarMenuItem>
          <SidebarMenuButton asChild className={menuBtnClassName}>
            <Link href="/chat">
              <Bot />
              <span>My Agents</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className={menuBtnClassName}>
            <Link href="/chat">
              <Calendar />
              <span>Schedules</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      {/* <Divider className="w-[calc(100%-30px)] mx-auto" /> */}
      <SidebarGroup className={sidebarGroupClassName}>
        <SidebarGroupLabel className={groupLabelClassName}>
          LLM Proxies
        </SidebarGroupLabel>
        <Divider className={dividerClassName} />
        <SidebarMenuItem>
          <SidebarMenuButton asChild className={menuBtnClassName}>
            <Link href="/chat">
              <Network />
              <span>My Proxies</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className={menuBtnClassName}>
            <Link href="/chat">
              <DollarSign />
              <span>Cost & Limits</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className={menuBtnClassName}>
            <Link href="/chat">
              <Logs />
              <span>Logs</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      {/* <Divider className="w-[calc(100%-30px)] mx-auto" /> */}
      <SidebarGroup className={sidebarGroupClassName}>
        <SidebarGroupLabel className={groupLabelClassName}>
          MCP Gateways
        </SidebarGroupLabel>
        <Divider className={dividerClassName} />
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive={false}
            className={menuBtnClassName}
          >
            <span>
              <Shield />
              My MCP Gateways
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className={menuBtnClassName}>
            <Link href="/chat">
              <Logs />
              <span>Logs</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      <SidebarGroup className={sidebarGroupClassName}>
        <SidebarGroupLabel className={groupLabelClassName}>
          Tools
        </SidebarGroupLabel>
        <Divider className={dividerClassName} />
        <SidebarMenuItem>
          <SidebarMenuButton asChild className={menuBtnClassName}>
            <Link href="/chat">
              <Router />
              <span>MCP Registry</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className={menuBtnClassName}>
            <Link href="/chat">
              <Wrench />
              <span>Tool Policies</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
      <Divider className="border-t-2 border-black/13 dark:border-white/13 mt-2 mb-2" />
      <SidebarGroup className={sidebarGroupClassName}>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className={menuBtnClassName}>
            <Link href="/chat">
              <Info />
              <span className="ml-1">How it works</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className={menuBtnClassName}>
            <Link href="/chat">
              <Cable />
              <span className="ml-1">Connect</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className={menuBtnClassName}>
            <Link href="/chat">
              <Settings />
              <span className="ml-1">Settings</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarGroup>
    </SidebarContent>
  );

  return option3;
};

const FooterSideBarSection = ({ pathname }: { pathname: string }) => (
  <SidebarFooter>
    {/* <SecurityEngineWarning />
    <DefaultCredentialsWarning /> */}
    <SignedIn>
      <SidebarGroup className="mt-auto">
        <SidebarGroupContent>
          <div data-testid={E2eTestId.SidebarUserProfile}>
            <UserButton
              size="default"
              align="center"
              className="w-full bg-transparent hover:bg-transparent text-foreground"
              disableDefaultLinks
            />
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </SignedIn>
    <SignedOut>
      <SidebarGroupContent className="mb-4">
        <SidebarGroupLabel>User</SidebarGroupLabel>
        <SidebarMenu>
          {userItems.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton asChild isActive={item.url === pathname}>
                <Link href={item.url}>
                  <item.icon />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SignedOut>
  </SidebarFooter>
);

export function AppSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isAuthenticated = useIsAuthenticated();
  const { data: starCount } = useGithubStars();
  const { logo, isLoadingAppearance } = useOrgTheme() ?? {};

  const logoToShow = logo ? (
    <div className="flex justify-center">
      <div className="flex flex-col items-center gap-1">
        <Image
          src={logo || "/logo.png"}
          alt="Organization logo"
          width={200}
          height={60}
          className="object-contain h-12 w-auto max-w-[calc(100vw-6rem)]"
        />
        <p className="text-[10px] text-muted-foreground">
          Powered by Archestra
        </p>
      </div>
    </div>
  ) : (
    <div className="flex items-center gap-2 px-2">
      <Image
        src="/logo.png"
        alt="Logo"
        width={28}
        height={28}
        className="h-auto w-auto"
      />
      <span className="text-base font-semibold">Archestra.AI</span>
    </div>
  );

  return (
    <Sidebar>
      <SidebarHeader className="flex flex-col gap-2">
        {isLoadingAppearance ? <div className="h-[47px]" /> : logoToShow}
      </SidebarHeader>
      <SidebarContent>
        {isAuthenticated ? (
          <MainSideBarSection
            isAuthenticated={isAuthenticated}
            pathname={pathname}
            searchParams={searchParams}
            starCount={starCount}
          />
        ) : (
          <CommunitySideBarSection starCount={starCount} />
        )}
      </SidebarContent>
      <FooterSideBarSection pathname={pathname} />
    </Sidebar>
  );
}

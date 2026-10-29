import { BookOpen, LayoutDashboard, Truck } from "lucide-react";
import type { GlobalMenuGroup, GlobalMenuItem } from "./GlobalMenu";

// Routes also present in WorkspaceDock remain available through the dock.
export const COMPANY_MENU_GROUPS: GlobalMenuGroup[] = [{ title: "", items: [
  { label: "Estrutura da Frota", icon: Truck, path: "/admin/fleet", state: { activeTab: "fleet" } },
  { label: "Manual", icon: BookOpen, path: "/admin/manual" },
] }];

export const DRIVER_MENU_ITEMS: GlobalMenuItem[] = [
  { label: "Painel Operacional", icon: LayoutDashboard, path: "/driver", exact: true },
  { label: "Manual", icon: BookOpen, path: "/driver/manual" },
];

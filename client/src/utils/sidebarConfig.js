import { 
  LayoutDashboard, 
  Layers, 
  UserPlus, 
  CheckSquare, 
  CreditCard, 
  Map, 
  FolderTree, 
  Building2, 
  ShoppingBag, 
  Users, 
  Package, 
  Truck, 
  FileText,
  UserCheck
} from 'lucide-react';

export const sidebarConfig = {
  MASTER: [
    {
      section: "Overview",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/master" },
        { label: "Revenue Models", icon: Layers, href: "/master/revenue-models" },
      ]
    },
    {
      section: "Partners",
      items: [
        { label: "Create State Partner", icon: UserPlus, href: "/master/partners" },
        { label: "Pending Approvals", icon: CheckSquare, href: "/master/approvals", badgeKey: "pendingApprovals" },
      ]
    },
    {
      section: "Finance",
      items: [
        { label: "Add Expense", icon: CreditCard, href: "/master/expenses" },
      ]
    },
    {
      section: "Geographic",
      items: [
        { label: "States Overview", icon: Map, href: "/master/states" },
        { label: "Districts & Regions", icon: FolderTree, href: "/master/districts-regions" },
      ]
    }
  ],
  STATE: [
    {
      section: "Overview",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/state" },
        { label: "Revenue Summary", icon: CreditCard, href: "/state/revenue" },
      ]
    },
    {
      section: "Partner Management",
      items: [
        { label: "Create Industry State Partner", icon: UserPlus, href: "/state/partners" },
        { label: "Approvals", icon: CheckSquare, href: "/state/approvals", badgeKey: "approvals" },
      ]
    },
    {
      section: "My State",
      items: [
        { label: "Districts Overview", icon: Map, href: "/state/districts" },
        { label: "Regions Overview", icon: FolderTree, href: "/state/regions" },
        { label: "Industries in State", icon: Layers, href: "/state/industries" },
      ]
    }
  ],
  IND_STATE: [
    {
      section: "Overview",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/industry-state" },
        { label: "Revenue Summary", icon: CreditCard, href: "/industry-state/revenue" },
      ]
    },
    {
      section: "Partner Management",
      items: [
        { label: "Create District Partner", icon: UserPlus, href: "/industry-state/partners" },
        { label: "Approvals", icon: CheckSquare, href: "/industry-state/approvals", badgeKey: "approvals" },
      ]
    },
    {
      section: "Manufacturers",
      items: [
        { label: "Create Manufacturer", icon: Building2, href: "/industry-state/create-manufacturer" },
        { label: "All Manufacturers", icon: ShoppingBag, href: "/industry-state/manufacturers", badgeKey: "manufacturers" },
      ]
    }
  ],
  DISTRICT: [
    {
      section: "Overview",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/district" },
        { label: "Revenue Summary", icon: CreditCard, href: "/district/revenue" },
      ]
    },
    {
      section: "Partner Management",
      items: [
        { label: "Create Regional Partner", icon: UserPlus, href: "/district/partners" },
        { label: "Executive Approvals", icon: UserCheck, href: "/district/executive-approvals", badgeKey: "executiveApprovals" },
      ]
    },
    {
      section: "My District",
      items: [
        { label: "Distributors", icon: Truck, href: "/district/distributors" },
        { label: "Regional Partners", icon: Users, href: "/district/regional-partners" },
      ]
    }
  ],
  REGIONAL: [
    {
      section: "Overview",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/regional" },
        { label: "Revenue Summary", icon: CreditCard, href: "/regional/revenue" },
      ]
    },
    {
      section: "Executive Management",
      items: [
        { label: "Create Executive Profile", icon: UserPlus, href: "/regional/create-executive" },
        { label: "All Executives", icon: Users, href: "/regional/executives", badgeKey: "executives" },
      ]
    },
    {
      section: "My Region",
      items: [
        { label: "Registered Shops", icon: ShoppingBag, href: "/regional/shops", badgeKey: "shops" },
        { label: "Delivery Partners", icon: Truck, href: "/regional/delivery-partners", badgeKey: "delivery" },
        { label: "Distributors", icon: Building2, href: "/regional/distributors" },
      ]
    }
  ],
  MANUFACTURER: [
    {
      section: "Overview",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/manufacturer" },
      ]
    },
    {
      section: "Products",
      items: [
        { label: "Add Product", icon: UserPlus, href: "/manufacturer/add-product" },
        { label: "Product Listing", icon: Package, href: "/manufacturer/products", badgeKey: "products" },
      ]
    },
    {
      section: "Orders",
      items: [
        { label: "From Distributors", icon: FileText, href: "/manufacturer/orders-distributors", badgeKey: "distributorOrders" },
        { label: "From State/District", icon: FileText, href: "/manufacturer/orders-bulk" },
        { label: "From Retail Outlets", icon: FileText, href: "/manufacturer/orders-retail" },
      ]
    },
    {
      section: "Network",
      items: [
        { label: "Distributors", icon: Truck, href: "/manufacturer/distributors", badgeKey: "distributors" },
        { label: "Distributor Requests", icon: CheckSquare, href: "/manufacturer/distributor-requests", badgeKey: "distributorRequests" },
        { label: "Add Branch", icon: Building2, href: "/manufacturer/branches" },
      ]
    },
    {
      section: "Team",
      items: [
        { label: "Add Field Staff", icon: UserPlus, href: "/manufacturer/add-staff" },
        { label: "Field Staff", icon: Users, href: "/manufacturer/staff", badgeKey: "staff" },
      ]
    }
  ],
  DISTRIBUTOR: [
    {
      section: "Overview",
      items: [
        { label: "Dashboard", icon: LayoutDashboard, href: "/distributor" },
        { label: "Warehouse & Products", icon: Package, href: "/distributor/products" },
      ]
    },
    {
      section: "Orders",
      items: [
        { label: "From Retail Outlets", icon: FileText, href: "/distributor/orders-retail", badgeKey: "retailOrders" },
        { label: "To Manufacturers", icon: FileText, href: "/distributor/orders-to-manufacturers" },
      ]
    },
    {
      section: "Supply Chain",
      items: [
        { label: "My Manufacturers", icon: Building2, href: "/distributor/manufacturers", badgeKey: "manufacturers" },
        { label: "Retail Outlets", icon: ShoppingBag, href: "/distributor/outlets", badgeKey: "outlets" },
      ]
    },
    {
      section: "Team",
      items: [
        { label: "Add Field Staff", icon: UserPlus, href: "/distributor/add-staff" },
        { label: "Field Staff", icon: Users, href: "/distributor/staff", badgeKey: "staff" },
      ]
    }
  ]
};

export const roleDetails = {
  MASTER: { name: "System Admin", role: "Master Dashboard", themeClass: "theme-master" },
  STATE: { name: "Rajesh Kumar", role: "State Partner", themeClass: "theme-state" },
  IND_STATE: { name: "Suresh Gowd", role: "Industry State Partner", themeClass: "theme-industry-state" },
  DISTRICT: { name: "Venkata Rao", role: "District Partner", themeClass: "theme-district" },
  REGIONAL: { name: "Naresh Reddy", role: "Regional Partner", themeClass: "theme-regional" },
  MANUFACTURER: { name: "Tata Motors Ltd", role: "Automobile Manufacturer", themeClass: "theme-manufacturer" },
  DISTRIBUTOR: { name: "Vikas Automobiles", role: "Authorized Distributor", themeClass: "theme-distributor" }
};

export type FirstRunDemoPage = "home" | "tasks" | "lists" | "unload";

export interface FirstRunDemoConfig {
  page: FirstRunDemoPage;
  title: string;
  description: string;
  ctaLabel: string;
  secondaryLabel: string;
  inputText?: string;
  taskOutputItems?: string[];
  listOutput?: {
    name: string;
    items: string[];
    interactiveItemIndex?: number;
  };
  groupedOutput?: {
    title: string;
    items: string[];
  }[];
}

export const FIRST_RUN_DEMO_CONFIG: Record<FirstRunDemoPage, FirstRunDemoConfig> = {
  home: {
    page: "home",
    title: "Your day, without the noise",
    description:
      "Laya pulls together what needs your attention today, tomorrow, and soon.",
    ctaLabel: "Show me my day",
    secondaryLabel: "Skip",
    taskOutputItems: [
      "Today: Pay electricity bill - 8 PM",
      "Tomorrow: Book Ved's football class",
      "Coming up this week: Call plumber",
    ],
  },
  tasks: {
    page: "tasks",
    title: "Turn thoughts into doable tasks",
    description:
      "Type naturally. Laya can pick out the task and when it needs to happen.",
    ctaLabel: "Add my first task",
    secondaryLabel: "Skip",
    inputText:
      "Need to call plumber tomorrow, pay school fees Friday, and remind me to order medicines tonight.",
    taskOutputItems: [
      "Call plumber - Tomorrow",
      "Pay school fees - Friday",
      "Order medicines - Tonight",
    ],
  },
  lists: {
    page: "lists",
    title: "Keep household lists in one place",
    description:
      "Make lists for groceries, errands, packing, repairs, or anything else at home.",
    ctaLabel: "Create a list",
    secondaryLabel: "Got it",
    listOutput: {
      name: "Grocery",
      items: ["Eggs", "Curd", "Apples", "Dishwash liquid"],
      interactiveItemIndex: 0,
    },
  },
  unload: {
    page: "unload",
    title: "Drop everything here",
    description:
      "Use Unload when your mind has tasks, reminders, and list items all mixed together.",
    ctaLabel: "Try my own brain dump",
    secondaryLabel: "Skip",
    inputText:
      "Buy curd, call plumber, book vaccine appointment, add bananas to grocery list.",
    groupedOutput: [
      { title: "Tasks", items: ["Call plumber", "Book vaccine appointment"] },
      { title: "Lists", items: ["Grocery: curd, bananas"] },
    ],
  },
};

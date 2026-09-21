import { JobDescription } from "../types/index.js";

export const seedJobDescriptions: JobDescription[] = [
  {
    id: "frontend-engineer-react",
    title: "Frontend Engineer",
    company: "Northwind Labs",
    seniority: "Mid-Level",
    description:
      "We're looking for a Frontend Engineer to build and maintain our customer-facing web application. You'll work closely with designers and backend engineers to ship performant, accessible UI using React and TypeScript. You'll own features end-to-end, from component architecture to state management and API integration.",
    mustHaveSkills: [
      "React",
      "TypeScript",
      "State management (Redux/Zustand/Context)",
      "REST API integration",
      "CSS/responsive design",
      "Browser performance optimization",
    ],
  },
  {
    id: "backend-engineer-node",
    title: "Backend Engineer",
    company: "Northwind Labs",
    seniority: "Mid-Level",
    description:
      "We're hiring a Backend Engineer to design and build scalable services powering our platform. You'll work primarily in Node.js and TypeScript, designing REST/GraphQL APIs, modeling data, and ensuring systems are reliable and observable. Experience with databases, caching, and distributed systems concepts is a plus.",
    mustHaveSkills: [
      "Node.js",
      "TypeScript",
      "REST API design",
      "SQL/relational databases",
      "Authentication & authorization",
      "System design fundamentals",
    ],
  },
  {
    id: "data-analyst",
    title: "Data Analyst",
    company: "Northwind Labs",
    seniority: "Junior-Mid",
    description:
      "We're seeking a Data Analyst to help turn raw data into actionable insights. You'll write SQL queries against large datasets, build dashboards, and partner with product and business teams to answer key questions. Familiarity with Python for data manipulation and basic statistics is expected.",
    mustHaveSkills: [
      "SQL",
      "Python (pandas)",
      "Data visualization",
      "Statistics fundamentals",
      "Dashboarding tools (e.g. Looker/Tableau)",
      "Communicating insights to non-technical stakeholders",
    ],
  },
  {
    id: "product-manager",
    title: "Product Manager",
    company: "Northwind Labs",
    seniority: "Mid-Level",
    description:
      "We're looking for a Product Manager to own the roadmap for one of our core product areas. You'll work closely with engineering, design, and go-to-market teams to identify customer problems worth solving, define what to build and why, and drive execution from discovery through launch. Strong judgment on tradeoffs and clear communication across functions are essential.",
    mustHaveSkills: [
      "Product strategy & roadmapping",
      "User research & discovery",
      "Data-informed decision making",
      "Cross-functional stakeholder management",
      "Prioritization frameworks",
      "Writing specs & communicating product decisions",
    ],
  },
];

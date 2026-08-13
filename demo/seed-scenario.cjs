const DEMO_BUDGETS = [
  {
    name: "Live Demo - Envelope",
    mode: "envelope",
    envName: "DEMO_BUDGET_SYNC_ID",
    stableGroupId: "7d243b3e-d2dc-4863-be75-b1fd85b77c2b",
  },
  {
    name: "Live Demo - Tracking",
    mode: "tracking",
    envName: "DEMO_TRACKING_BUDGET_SYNC_ID",
    stableGroupId: "5e48dea9-96ef-4f5e-ba26-10a5af1e4da2",
  },
];

const CATEGORY_GROUPS = [
  {
    key: "income",
    name: "Income",
    income: true,
    categories: [
      ["primarySalary", "Primary Salary"],
      ["secondarySalary", "Secondary Salary"],
      ["bonus", "Bonus"],
      ["interest", "Interest"],
      ["reimbursements", "Reimbursements"],
    ],
  },
  {
    key: "housing",
    name: "Housing",
    categories: [
      ["mortgage", "Mortgage"],
      ["electric", "Electricity"],
      ["naturalGas", "Natural Gas"],
      ["water", "Water & Sewer"],
      ["internet", "Internet"],
      ["mobile", "Mobile Phones"],
      ["homeMaintenance", "Home Maintenance"],
      ["homeInsurance", "Home Insurance"],
    ],
  },
  {
    key: "food",
    name: "Food & Dining",
    categories: [
      ["groceries", "Groceries"],
      ["restaurants", "Restaurants"],
      ["coffee", "Coffee"],
      ["workLunches", "Work Lunches"],
    ],
  },
  {
    key: "transport",
    name: "Transportation",
    categories: [
      ["fuel", "Fuel"],
      ["transit", "Public Transit"],
      ["autoInsurance", "Auto Insurance"],
      ["autoMaintenance", "Maintenance & Repairs"],
      ["registration", "Registration"],
      ["parking", "Parking & Tolls"],
      ["carPayment", "Car Payment"],
    ],
  },
  {
    key: "health",
    name: "Health & Wellness",
    categories: [
      ["healthInsurance", "Health Insurance"],
      ["medical", "Medical"],
      ["dental", "Dental"],
      ["pharmacy", "Pharmacy"],
      ["fitness", "Fitness"],
    ],
  },
  {
    key: "family",
    name: "Family & Pets",
    categories: [
      ["childcare", "Childcare"],
      ["school", "School Expenses"],
      ["kidsActivities", "Kids Activities"],
      ["petCare", "Pet Care"],
      ["petSupplies", "Pet Supplies"],
    ],
  },
  {
    key: "lifestyle",
    name: "Lifestyle",
    categories: [
      ["clothing", "Clothing"],
      ["household", "Household Goods"],
      ["personalCare", "Personal Care"],
      ["entertainment", "Entertainment"],
      ["subscriptions", "Subscriptions"],
      ["hobbies", "Hobbies"],
      ["miscellaneous", "Miscellaneous"],
      ["legacyCable", "Legacy Cable TV"],
    ],
  },
  {
    key: "giving",
    name: "Giving",
    categories: [
      ["gifts", "Gifts"],
      ["charity", "Charitable Giving"],
    ],
  },
  {
    key: "goals",
    name: "Savings & Goals",
    categories: [
      ["emergencyFund", "Emergency Fund"],
      ["vacationFund", "Vacation Fund"],
      ["homeImprovement", "Home Improvement"],
      ["annualBills", "Annual Bills"],
    ],
  },
  {
    key: "debt",
    name: "Debt Payments",
    categories: [
      ["studentLoan", "Student Loan"],
      ["creditInterest", "Credit Card Interest"],
    ],
  },
];

const BASE_BUDGETS = {
  mortgage: 185000,
  electric: 11000,
  naturalGas: 7000,
  water: 6500,
  internet: 7500,
  mobile: 9500,
  homeMaintenance: 12000,
  homeInsurance: 13500,
  groceries: 70000,
  restaurants: 26000,
  coffee: 6500,
  workLunches: 11000,
  fuel: 18000,
  transit: 8000,
  autoInsurance: 14000,
  autoMaintenance: 10000,
  registration: 0,
  parking: 5500,
  carPayment: 38000,
  healthInsurance: 46000,
  medical: 9000,
  dental: 5000,
  pharmacy: 3500,
  fitness: 5000,
  childcare: 78000,
  school: 6000,
  kidsActivities: 9000,
  petCare: 6500,
  petSupplies: 6500,
  clothing: 11000,
  household: 15000,
  personalCare: 8000,
  entertainment: 11000,
  subscriptions: 5500,
  hobbies: 8000,
  miscellaneous: 5000,
  legacyCable: 0,
  gifts: 8000,
  charity: 10000,
  emergencyFund: 25000,
  vacationFund: 18000,
  homeImprovement: 12000,
  annualBills: 15000,
  studentLoan: 28000,
  creditInterest: 0,
};

const TAGS = [
  ["reimbursable", "#2563eb", "Costs expected to be reimbursed by work, school, or family."],
  ["vacation", "#0891b2", "Travel and activities from the household summer vacation."],
  ["medical", "#dc2626", "Medical, dental, and pharmacy expenses for follow-up."],
  ["home-project", "#ca8a04", "Purchases and contractors associated with a home project."],
  ["work", "#4f46e5", "Work-related purchases and meals."],
  ["tax", "#9333ea", "Potentially tax-relevant expenses and documents."],
  ["gift", "#db2777", "Birthday, holiday, and celebration gifts."],
  ["review", "#ea580c", "Imported transactions that still need human review."],
  ["annual", "#16a34a", "Annual or infrequent bills funded throughout the year."],
  ["shared", "#64748b", "Expenses shared with friends or extended family."],
];

function pad(value) {
  return String(value).padStart(2, "0");
}

function buildMonths(now = new Date()) {
  const months = [];
  for (let offset = 12; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    months.push({
      y: date.getFullYear(),
      mIdx: date.getMonth(),
      monthNumber: date.getMonth() + 1,
      key: `${date.getFullYear()}-${pad(date.getMonth() + 1)}`,
      isCurrent: offset === 0,
      dayLimit: offset === 0 ? Math.max(1, now.getDate()) : 28,
    });
  }
  return months;
}

function budgetPlanForMonth(month) {
  const plan = { ...BASE_BUDGETS };
  const number = month.monthNumber;

  if ([12, 1, 2].includes(number)) {
    plan.electric = 14500;
    plan.naturalGas = 12500;
  } else if ([6, 7, 8].includes(number)) {
    plan.electric = 15500;
    plan.naturalGas = 3500;
  }

  if ([3, 4, 5].includes(number)) plan.homeMaintenance = 24000;
  if ([6, 7].includes(number)) plan.vacationFund = 32000;
  if (number === 7) plan.vacationFund = 0;
  if (number === 8 || number === 9) plan.school = 26000;
  if (number === 11) plan.gifts = 22000;
  if (number === 12) plan.gifts = 52000;
  if (number === 5) plan.registration = 18000;
  if (number === 1) plan.annualBills = 28000;

  return plan;
}

function scenarioForMonth(month, index) {
  const scenario = {
    label: "typical",
    discretionaryFactor: 1,
    groceryFactor: 1,
    restaurantFactor: 1,
    incomeAdjustment: 0,
    event: null,
  };

  if (index === 1 || index === 5 || index === 9) {
    scenario.label = "good";
    scenario.discretionaryFactor = 0.72;
    scenario.groceryFactor = 0.9;
    scenario.restaurantFactor = 0.65;
  }
  if (index === 3) {
    scenario.label = "bad-car-repair";
    scenario.discretionaryFactor = 1.08;
    scenario.event = "carRepair";
  }
  if (index === 6) {
    scenario.label = "bad-medical";
    scenario.restaurantFactor = 0.8;
    scenario.event = "medicalDeductible";
  }
  if (index === 8) {
    scenario.label = "lower-income";
    scenario.discretionaryFactor = 0.8;
    scenario.incomeAdjustment = -120000;
  }
  if (index === 10) {
    scenario.label = "bonus-recovery";
    scenario.discretionaryFactor = 0.9;
    scenario.incomeAdjustment = 180000;
    scenario.event = "bonus";
  }
  if (month.monthNumber === 12) {
    scenario.label = "bad-holiday";
    scenario.discretionaryFactor = 1.22;
    scenario.restaurantFactor = 1.3;
    scenario.event = "holiday";
  }
  if (month.monthNumber === 7) {
    scenario.label = "planned-vacation";
    scenario.discretionaryFactor = 1.08;
    scenario.event = "vacation";
  }
  if (month.isCurrent) {
    scenario.label = "current-partial";
  }

  return scenario;
}

module.exports = {
  BASE_BUDGETS,
  CATEGORY_GROUPS,
  DEMO_BUDGETS,
  TAGS,
  budgetPlanForMonth,
  buildMonths,
  pad,
  scenarioForMonth,
};

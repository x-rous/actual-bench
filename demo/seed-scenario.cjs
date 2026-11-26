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
      ["rentalIncome", "Rental Income"],
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
      ["rentalMortgage", "Rental Mortgage"],
      ["rentalExpenses", "Rental Property Expenses"],
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
      ["investing", "Investing"],
    ],
  },
  {
    key: "debt",
    name: "Debt Payments",
    categories: [
      ["studentLoan", "Student Loan"],
      ["creditInterest", "Credit Card Interest"],
      ["personalPayment", "Personal Loan Payment"],
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
  investing: 30000,
  studentLoan: 28000,
  creditInterest: 4000,
  rentalMortgage: 100000,
  rentalExpenses: 25000,
  personalPayment: 25000,
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
  ["family-holiday", "#0e7490", "Costs from the family summer holiday."],
  ["rental-property", "#7c3aed", "Income and expenses for the rental property."],
  ["loan-interest", "#b45309", "Interest charged by lenders."],
  ["shared", "#64748b", "Expenses shared with friends or extended family."],
];

function pad(value) {
  return String(value).padStart(2, "0");
}

/**
 * Two complete years and the running month. The household's story turns at
 * the start of the second year (a raise, a cancelled cable plan, less takeaway,
 * more invested), so Financial Insights can compare a year with the one before
 * and the change reads as something that happened, not as noise.
 */
const HISTORY_MONTHS = 24;

/** Months before this index are the first year ("before"); from it on, the second ("after"). */
const TURNING_POINT = HISTORY_MONTHS - 12;

function buildMonths(now = new Date()) {
  const months = [];
  for (let offset = HISTORY_MONTHS; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const index = HISTORY_MONTHS - offset;
    months.push({
      y: date.getFullYear(),
      mIdx: date.getMonth(),
      monthNumber: date.getMonth() + 1,
      key: `${date.getFullYear()}-${pad(date.getMonth() + 1)}`,
      index,
      phase: index < TURNING_POINT ? "before" : "after",
      isCurrent: offset === 0,
      dayLimit: offset === 0 ? Math.max(1, now.getDate()) : 28,
    });
  }
  return months;
}

function budgetPlanForMonth(month) {
  const plan = { ...BASE_BUDGETS };
  const number = month.monthNumber;

  // The second year, after the raise: dining planned a little lower, and the
  // money freed up goes to investing.
  if (month.phase === "after") {
    plan.restaurants = 22000;
    plan.investing = 90000;
  }
  // The cable plan is paid until it is cancelled in the first year's tenth month.
  if (month.index !== undefined && month.index < 9) plan.legacyCable = 8900;

  if ([12, 1, 2].includes(number)) {
    plan.electric = 14500;
    plan.naturalGas = 12500;
  } else if ([6, 7, 8].includes(number)) {
    plan.electric = 15500;
    plan.naturalGas = 3500;
  }

  if ([3, 4, 5].includes(number)) plan.homeMaintenance = 24000;
  // June pre-funds the trip; July spends the rollover without new funding.
  if (number === 6) plan.vacationFund = 32000;
  if (number === 7) plan.vacationFund = 0;
  if (number === 8 || number === 9) plan.school = 26000;
  if (number === 11) plan.gifts = 22000;
  if (number === 12) plan.gifts = 52000;
  if (number === 5) plan.registration = 18000;
  if (number === 1) plan.annualBills = 28000;

  return plan;
}

function scenarioForMonth(month, index) {
  // The first year runs hot (takeaway, dining, impulse buys); the second is
  // the same household after deciding to change that.
  const before = index < TURNING_POINT;
  const scenario = {
    label: "typical",
    discretionaryFactor: before ? 1.12 : 0.94,
    groceryFactor: 1,
    restaurantFactor: before ? 1.3 : 0.85,
    incomeAdjustment: 0,
    bonusAmount: 0,
    event: null,
  };

  if ([13, 17, 20].includes(index)) {
    scenario.label = "good";
    scenario.discretionaryFactor = 0.72;
    scenario.groceryFactor = 0.9;
    scenario.restaurantFactor = 0.65;
  }
  if (index === 3) {
    scenario.label = "bad-car-repair";
    scenario.discretionaryFactor = 1.18;
    scenario.event = "carRepair";
  }
  if (index === 15) {
    scenario.label = "bad-medical";
    scenario.restaurantFactor = 0.8;
    scenario.event = "medicalDeductible";
  }
  if (index === 8) {
    scenario.label = "lower-income";
    scenario.discretionaryFactor = 0.95;
    scenario.incomeAdjustment = -120000;
  }
  if (index === 10 || index === 22) {
    scenario.label = index === 10 ? "bonus" : "bonus-recovery";
    scenario.discretionaryFactor = before ? 1 : 0.9;
    scenario.event = "bonus";
    scenario.bonusAmount = index === 10 ? 120000 : 240000;
  }
  if (month.monthNumber === 12) {
    scenario.label = "bad-holiday";
    scenario.discretionaryFactor = before ? 1.3 : 1.12;
    scenario.restaurantFactor = before ? 1.45 : 1.15;
    scenario.event = "holiday";
  }
  if (month.monthNumber === 7) {
    scenario.label = "planned-vacation";
    scenario.discretionaryFactor = before ? 1.15 : 1.02;
    scenario.event = "vacation";
  }
  if (month.isCurrent) {
    scenario.label = "current-partial";
  }

  return scenario;
}

/**
 * Monthly market moves for the brokerage, in percent: a rising market with
 * real down months, so the Investments tab shows growth that was not a
 * straight line. The retirement fund moves with it, a little more gently.
 */
const MARKET_RETURNS = [
  1.2, 0.8, -1.6, 2.1, 0.9, 1.4, -3.8, -2.2, 2.9, 1.7, 0.6, 1.3,
  1.9, -0.7, 1.1, 2.4, 0.5, -4.6, 3.1, 1.8, 0.9, 1.2, -0.9, 1.6, 0.4,
];

module.exports = {
  BASE_BUDGETS,
  CATEGORY_GROUPS,
  DEMO_BUDGETS,
  HISTORY_MONTHS,
  MARKET_RETURNS,
  TAGS,
  TURNING_POINT,
  budgetPlanForMonth,
  buildMonths,
  pad,
  scenarioForMonth,
};
